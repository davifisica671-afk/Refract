/**
 * Toast — Sistema de notificações efêmeras
 *
 * Componente baseado no Radix UI Toast para exibir mensagens temporárias
 * ao usuário. Suporta três variantes: neutral (amarelo), sucesso (verde)
 * e erro (vermelho). Os toasts aparecem na parte superior esquerda da
 * tela e incluem título, descrição, botão de ação e botão de fechar.
 */
import * as React from "react"
import * as ToastPrimitive from "@radix-ui/react-toast"
import { cn } from "../../lib/utils"
import { X } from "lucide-react"

/** Provedor raiz do sistema de toasts — deve envolver a árvore de componentes */
const ToastProvider = ToastPrimitive.Provider

export type ToastMessage = {
  title: string
  description: string
  variant: ToastVariant
}

/** Viewport (área de exibição) dos toasts — fixo no canto inferior direito da tela */
const ToastViewport = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Viewport>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Viewport>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Viewport
    ref={ref}
    className={cn(
      "bg-transparent fixed bottom-0 right-0 z-[100] flex max-h-screen w-full flex-col-reverse gap-2 p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[390px]",
      className
    )}
    {...props}
  />
))
ToastViewport.displayName = ToastPrimitive.Viewport.displayName

/** Tipos de variante do toast: neutro, sucesso ou erro */
type ToastVariant = "neutral" | "success" | "error"

interface ToastProps
  extends React.ComponentPropsWithoutRef<typeof ToastPrimitive.Root> {
  variant?: ToastVariant
}

/** Mapeamento de variantes para classes de cor */
const toastVariants: Record<ToastVariant, string> = {
  neutral: "border-amber-400/25",
  success: "border-emerald-400/25",
  error: "border-red-400/25"
}

const Toast = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Root>,
  ToastProps
>(({ className, variant = "neutral", ...props }, ref) => (
  <ToastPrimitive.Root
    ref={ref}
    className={cn(
      "toast-surface group relative w-full overflow-hidden px-4 py-3 pr-10 animate-in fade-in slide-in-from-bottom-2",
      toastVariants[variant],
      className
    )}
    {...props}
  />
))
Toast.displayName = ToastPrimitive.Root.displayName

/** Botão de ação dentro do toast */
const ToastAction = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Action>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Action
    ref={ref}
    className={cn(
      "inline-flex h-7 items-center rounded-md border border-border-subtle bg-bg-item-active px-2.5 text-[11px] font-medium text-text-primary hover:bg-bg-component transition-colors",
      className
    )}
    {...props}
  />
))
ToastAction.displayName = ToastPrimitive.Action.displayName

/** Botão de fechar o toast (ícone X) */
const ToastClose = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Close>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Close>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Close
    ref={ref}
    className={cn(
      "absolute right-2.5 top-2.5 flex h-7 w-7 items-center justify-center rounded-md text-text-tertiary hover:bg-bg-item-active hover:text-text-primary transition-colors",
      className
    )}
    {...props}
  >
    <X className="h-4 w-4" />
  </ToastPrimitive.Close>
))
ToastClose.displayName = ToastPrimitive.Close.displayName

/** Título do toast */
const ToastTitle = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Title>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Title
    ref={ref}
    className={cn("text-[13px] font-semibold text-text-primary", className)}
    {...props}
  />
))
ToastTitle.displayName = ToastPrimitive.Title.displayName

/** Descrição (corpo) do toast */
const ToastDescription = React.forwardRef<
  React.ElementRef<typeof ToastPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof ToastPrimitive.Description>
>(({ className, ...props }, ref) => (
  <ToastPrimitive.Description
    ref={ref}
    className={cn("mt-1 text-[11.5px] leading-relaxed text-text-secondary", className)}
    {...props}
  />
))
ToastDescription.displayName = ToastPrimitive.Description.displayName

export type { ToastProps, ToastVariant }
export {
  ToastProvider,
  ToastViewport,
  Toast,
  ToastAction,
  ToastClose,
  ToastTitle,
  ToastDescription
}
