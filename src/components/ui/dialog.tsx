/**
 * Dialog — Componente de caixa de diálogo modal
 *
 * Componente baseado no Radix UI Dialog para exibir modais sobrepostos.
 * Inclui um overlay escurecido, conteúdo centralizado na tela e suporte
 * a Portal para renderização fora da árvore DOM principal.
 */
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { cn } from "../../lib/utils"

/** Raiz do componente de diálogo */
const Dialog = DialogPrimitive.Root
/** Elemento que dispara a abertura do diálogo */
const DialogTrigger = DialogPrimitive.Trigger
/** Portal para renderizar o conteúdo fora da árvore DOM pai */
const DialogPortal = DialogPrimitive.Portal

/** Overlay escurecido que cobre toda a tela atrás do diálogo */
const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/60 backdrop-blur-[10px]",
      "data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=open]:fade-in data-[state=closed]:fade-out",
      className
    )}
    {...props}
  />
))
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName

/** Conteúdo principal do diálogo, centralizado na tela */
const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPortal>
    <DialogOverlay />
    <DialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2",
        "dialog-surface p-6",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=open]:fade-in data-[state=closed]:fade-out",
        "data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95",
        className
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPortal>
))
DialogContent.displayName = DialogPrimitive.Content.displayName

/** Elemento que fecha o diálogo ao ser clicado */
const DialogClose = DialogPrimitive.Close

export { Dialog, DialogTrigger, DialogContent, DialogClose }
