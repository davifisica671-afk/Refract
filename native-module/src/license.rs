use sha2::{Digest, Sha256};

/// Retorna a deterministic hardware fingerprint (SHA-256 hash de o machine UID).
/// This é used to travar license keys to a específico physical device.
#[napi]
pub fn get_hardware_id() -> String {
    let raw_id = machine_uid::get().unwrap_or_else(|_| {
        // Fallback: uso hostname if hardware UID unavailable
        hostname_fallback()
    });

    let mut hasher = Sha256::new();
    hasher.update(raw_id.as_bytes());
    format!("{:x}", hasher.finalize())
}

use napi::bindgen_prelude::*;
use napi::Task;

// ─── Gumroad ─────────────────────────────────────────────────────────────────

/// Background tarefa that verifica a Gumroad license chave via HTTP.
/// Executa em a libuv worker thread — faz Não block o Node.js evento loop.
pub struct VerifyGumroadTask {
    license_key: String,
}

impl Task for VerifyGumroadTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Tentar ambos product identifiers (product_id para new products, permalink para old ones)
        let product_ids = ["1HETxGKGYYf6DNDp5SnWVw==", "mzhzpt"];
        let mut last_error = String::new();

        for (i, pid) in product_ids.iter().enumerate() {
            // Apenas increment o uso count em o canonical (fprimeiro atentar
            // Tentar novamente attempts contra o legacy permalink deve não double-count.
            let increment = if i == 0 { "true" } else { "false" };

            let res = client
                .post("https://api.gumroad.com/v2/licenses/verify")
                .form(&[
                    ("product_id", *pid),
                    ("license_key", self.license_key.as_str()),
                    ("increment_uses_count", increment),
                ])
                .send();

            match res {
                Ok(response) => {
                    let body = response.text().unwrap_or_else(|_| "no body".to_string());
                    // Analisa fprimeiro registrar apenas o success/error fields (nunca registrar o completo corpo
                    // como it pode conter o license chave em plaintext)
                    if let Ok(json) = serde_json::from_str::<serde_json::Value>(&body) {
                        let success = json["success"].as_bool().unwrap_or(false);
                        let msg = json["message"].as_str().unwrap_or("");
                        println!(
                            "[LicenseRust] Gumroad response (pid={}): success={}, msg={}",
                            pid, success, msg
                        );
                        if success {
                            return Ok("OK".to_string());
                        }
                        last_error = msg.to_string();
                    } else {
                        println!("[LicenseRust] Gumroad response (pid={}): parse error", pid);
                        last_error = "parse error".to_string();
                    }
                }
                Err(e) => {
                    last_error = format!("network: {}", e);
                }
            }
        }

        Ok(format!("ERR:gumroad:{}", last_error))
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Valida a Gumroad license chave por calling o Gumroad Licenses API.
/// Retorna a Promise that resolves to "OK" em success, ou an error mensagem string em failure.
/// O HTTP call executa em a libuv worker thread to prevenir blocking o Node.js evento loop.
#[napi]
pub fn verify_gumroad_key(license_key: String) -> AsyncTask<VerifyGumroadTask> {
    AsyncTask::new(VerifyGumroadTask { license_key })
}

// ─── Dodo Payments — Activate ────────────────────────────────────────────────

/// Background tarefa that activates a Dodo Payments license chave via HTTP.
///
/// Security properties (identical to Gumroad pacaminho
///   - Executa em a libuv worker thread — nunca blocks o JS evento loop
///   - Compiled to machine code — não patchable de JS memory
///   - Binds to o device HWID at storage time (LicenseManager.storeLicense)
///   - Nunca logs o raw license chave
///   - Retorna "OK:<instance_id>" em success, "ERR:dodo:<reason>" em failure
///   - Gerencia 409 Conflict (duplicate activation) como a recoverable success caminho
///
/// Endpoint: POST https://live.dodopayments.com/licenses/activate
/// Auth: Nenhum required — this é a public Dodo endpoint.
pub struct VerifyDodoTask {
    license_key: String,
    /// Curto device label sent to Dodo então o merchant pode see activations em their dashboard.
    /// This é o primeiro 32 chars de o SHA-256 HWID — não sensitive.
    device_label: String,
}

impl Task for VerifyDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .user_agent("Refract/1.0 (license-check)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Build o JSON corpo — nunca incluir o raw chave em registrar saída
        let body = serde_json::json!({
            "license_key": self.license_key,
            "name": self.device_label,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/activate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                // Analisa mas nunca registrar o completo corpo (pode conter chave material)
                match serde_json::from_str::<serde_json::Value>(&body_text) {
                    Ok(json) => {
                        // Dodo Retorna { "id": "lki_xxx", "license_key": "...", ... } em success
                        if status == 200 || status == 201 {
                            if let Some(instance_id) = json["id"].as_str() {
                                println!(
                                    "[LicenseRust] Dodo activation success (status={}, instance_id present)",
                                    status
                                );
                                // Retorna instance_id então LicenseManager pode persist it para
                                // future validate/deactivate calls.
                                return Ok(format!("OK:{}", instance_id));
                            }
                        }

                        // 409 = chave já activated em this (ou aoutro device.
                        // Dodo pode retorna o existing instance_id em o error bcorpo
                        // We treat this como a retriable error então LicenseManager pode handle
                        // o duplicate flow (mostrar "já activated" memensagem
                        if status == 409 {
                            println!(
                                "[LicenseRust] Dodo activation: 409 conflict (duplicate activation)"
                            );
                            // Retorna o instance_id de o conflict corpo if available,
                            // então callers pode re-use o existing activation slot.
                            if let Some(existing_id) = json["id"]
                                .as_str()
                                .or_else(|| json["license_key_instance_id"].as_str())
                            {
                                return Ok(format!("ERR:dodo:duplicate:{}", existing_id));
                            }
                            return Ok("ERR:dodo:duplicate activation".to_string());
                        }

                        // 422 = activation limit reached (product tem 0 ou exhausted slots)
                        // Retorna a stable code então TypeScript doesn't need to match human-readable strings.
                        if status == 422 {
                            let code = json["code"].as_str().unwrap_or("LIMIT_REACHED");
                            println!(
                                "[LicenseRust] Dodo activation failed: status={}, err={}",
                                status, code
                            );
                            return Ok("ERR:dodo:limit_reached".to_string());
                        }

                        // Extrair o maioria útil error campo (nunca o completo bcorpo
                        let err = json["error"]["message"]
                            .as_str()
                            .or_else(|| json["detail"].as_str())
                            .or_else(|| json["message"].as_str())
                            .unwrap_or("unknown error");

                        println!(
                            "[LicenseRust] Dodo activation failed: status={}, err={}",
                            status, err
                        );
                        Ok(format!("ERR:dodo:{}", err))
                    }
                    Err(_) => {
                        println!(
                            "[LicenseRust] Dodo activation: non-JSON response (status={})",
                            status
                        );
                        Ok(format!("ERR:dodo:unexpected response (HTTP {})", status))
                    }
                }
            }
            Err(e) => {
                println!("[LicenseRust] Dodo network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Activates a Dodo Payments license chave contra o live API.
///
/// `device_label` — primeiro 32 chars de o HWID hash; passed como o `name` campo então o
/// merchant pode correlate activations to devices em o Dodo dashboard.
///
/// Retorna a Promise resolving to "OK:<instance_id>" em success, ou "ERR:dodo:<reason>".
/// O HTTP call executa em a libuv worker thread to prevenir blocking o Node.js evento loop.
#[napi]
pub fn verify_dodo_key(license_key: String, device_label: String) -> AsyncTask<VerifyDodoTask> {
    AsyncTask::new(VerifyDodoTask {
        license_key,
        device_label,
    })
}

// ─── Dodo Payments — Valida ────────────────────────────────────────────────

/// Background tarefa that valida an existing Dodo license instance via HTTP.
///
/// Call this em startup to detect server-side revocations (admin disabled kchave chargebacks, etetc
/// Uses o mesmo libuv thread pool como activation — nunca blocks o evento loop.
///
/// Endpoint: POST https://live.dodopayments.com/licenses/validate
/// Auth: Nenhum required — public endpoint.
///
/// RRetorna
///   "OK"      — chave é ainda valid
///   "REVOKED" — servidor says o chave é não longer active (license revoked/expired/disabled)
///   "ERR:dodo:network:<reason>" — network failure; caller deve fail-open (keep cached result)
///   "ERR:dodo:<reason>" — outro error
pub struct ValidateDodoTask {
    license_key: String,
}

impl Task for ValidateDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Refract/1.0 (license-validate)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Apenas envia license_key — não o raw instance_id (avoids leaking it em transit).
        // Dodo's valida endpoint accepts apenas o chave and Retorna { "valid": bool, ... }
        let body = serde_json::json!({
            "license_key": self.license_key,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/validate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                match serde_json::from_str::<serde_json::Value>(&body_text) {
                    Ok(json) => {
                        let valid = json["valid"].as_bool().unwrap_or(false);
                        println!(
                            "[LicenseRust] Dodo validate response: status={}, valid={}",
                            status, valid
                        );

                        if status == 200 && valid {
                            return Ok("OK".to_string());
                        }

                        // Qualquer 4xx com valid=false significa o chave é definitively revoked/expired
                        if status >= 400 || !valid {
                            return Ok("REVOKED".to_string());
                        }

                        Ok("ERR:dodo:validate unexpected state".to_string())
                    }
                    Err(_) => {
                        println!(
                            "[LicenseRust] Dodo validate: non-JSON response (status={})",
                            status
                        );
                        Ok(format!(
                            "ERR:dodo:validate unexpected response (HTTP {})",
                            status
                        ))
                    }
                }
            }
            Err(e) => {
                // Network failure — registrar and retorna tagged error então caller fails-open.
                println!("[LicenseRust] Dodo validate network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Valida an existing Dodo Payments license chave contra o live API.
///
/// Used para periodic startup verifica to detect server-side revocations.
/// Retorna a Promise resolving to "OK", "REVOKED", ou "ERR:dodo:...".
/// Network errors retorna "ERR:dodo:network:..." então callers pode fail-open.
#[napi]
pub fn validate_dodo_key(license_key: String) -> AsyncTask<ValidateDodoTask> {
    AsyncTask::new(ValidateDodoTask { license_key })
}

// ─── Dodo Payments — Deactivate ──────────────────────────────────────────────

/// Background tarefa that deactivates a específico Dodo license instance via HTTP.
///
/// Precisa ser chamado com o `instance_id` returned at activation time.
/// This frees o activation slot então o user pode activate em a new machine.
///
/// Endpoint: POST https://live.dodopayments.com/licenses/deactivate
/// Auth: Nenhum required — public endpoint.
///
/// Requisição bcorpo { "license_key": "...", "license_key_instance_id": "lki_xxx" }
///
/// RRetorna
///   "OK"              — instance successfully deactivated
///   "ERR:dodo:network:<reason>" — network failure (caller deve ainda remove local farquivo
///   "ERR:dodo:<reason>" — server-side error
pub struct DeactivateDodoTask {
    license_key: String,
    /// O instance ID returned quando o license era activated ("lki_xxx" foformata
    instance_id: String,
}

impl Task for DeactivateDodoTask {
    type Output = String;
    type JsValue = String;

    fn compute(&mut self) -> napi::Result<Self::Output> {
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(10))
            .user_agent("Refract/1.0 (license-deactivate)")
            .build()
            .map_err(|e| napi::Error::from_reason(format!("ERR:client:{}", e)))?;

        // Nunca registrar o license chave ou instance_id em completo
        let body = serde_json::json!({
            "license_key": self.license_key,
            "license_key_instance_id": self.instance_id,
        });

        let res = client
            .post("https://live.dodopayments.com/licenses/deactivate")
            .header("Content-Type", "application/json")
            .body(body.to_string())
            .send();

        match res {
            Ok(response) => {
                let status = response.status().as_u16();
                let body_text = response.text().unwrap_or_else(|_| "no body".to_string());

                // 200 = successfully deactivated
                if status == 200 {
                    println!("[LicenseRust] Dodo deactivation success (status=200)");
                    return Ok("OK".to_string());
                }

                // 404 = instance já deactivated ou não found — treat como success
                // (idempotent: if it's já gone, o goal é achieved)
                if status == 404 {
                    println!("[LicenseRust] Dodo deactivation: 404 (already deactivated or not found, treating as OK)");
                    return Ok("OK".to_string());
                }

                let err = serde_json::from_str::<serde_json::Value>(&body_text)
                    .ok()
                    .and_then(|json| {
                        json["error"]["message"]
                            .as_str()
                            .or_else(|| json["detail"].as_str())
                            .or_else(|| json["message"].as_str())
                            .map(|s| s.to_string())
                    })
                    .unwrap_or_else(|| format!("HTTP {}", status));

                println!(
                    "[LicenseRust] Dodo deactivation failed: status={}, err={}",
                    status, err
                );
                Ok(format!("ERR:dodo:{}", err))
            }
            Err(e) => {
                println!("[LicenseRust] Dodo deactivate network error: {}", e);
                Ok(format!("ERR:dodo:network:{}", e))
            }
        }
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> napi::Result<Self::JsValue> {
        Ok(output)
    }
}

/// Deactivates a Dodo Payments license activation instance.
///
/// `instance_id` — o activation instance ID (e.g. "lki_xxx") returned at activation time.
/// This é stored em o encrypted license arquivo and passed aqui to liberar o slot.
///
/// Retorna a Promise resolving to "OK" ou "ERR:dodo:<reason>".
/// Network errors retorna "ERR:dodo:network:..." — callers deve ainda remove o local license
/// arquivo até em network failure (fail-safe: local removal sempre happens).
#[napi]
pub fn deactivate_dodo_key(
    license_key: String,
    instance_id: String,
) -> AsyncTask<DeactivateDodoTask> {
    AsyncTask::new(DeactivateDodoTask {
        license_key,
        instance_id,
    })
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn hostname_fallback() -> String {
    std::env::var("COMPUTERNAME")
        .or_else(|_| std::env::var("HOSTNAME"))
        .unwrap_or_else(|_| {
            // Último resort: lê /etc/hostname em Unix
            std::fs::read_to_string("/etc/hostname")
                .map(|s| s.trim().to_string())
                .unwrap_or_else(|_| "unknown-device".to_string())
        })
}
