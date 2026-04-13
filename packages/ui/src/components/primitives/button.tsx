import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 active:scale-95",
  {
    variants: {
      variant: {
        default: "bg-wine-600 text-white hover:bg-wine-700 shadow-md hover:shadow-lg",
        destructive: "bg-red-600 text-white hover:bg-red-700 shadow-md",
        outline: "border-2 border-wine-300 bg-transparent hover:bg-wine-50 text-wine-700",
        secondary: "bg-wine-100 text-wine-900 hover:bg-wine-200",
        ghost: "hover:bg-wine-50 hover:text-wine-700",
        link: "text-wine-600 underline-offset-4 hover:underline",
        success: "bg-wine-green-600 text-white hover:bg-wine-green-700 shadow-md",
        glass: "bg-white/60 backdrop-blur-md border border-white/20 hover:bg-white/80 shadow-lg",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-8 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button"
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }

