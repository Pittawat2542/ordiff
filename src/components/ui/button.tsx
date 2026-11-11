import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Slot } from "@radix-ui/react-slot";

const buttonVariants = cva("disabled:pointer-events-none", {
  variants: {
    variant: {
      default:
        "primary-button inline-flex items-center justify-center whitespace-nowrap",
      secondary:
        "secondary-button inline-flex items-center justify-center whitespace-nowrap",
      ghost: "icon-button",
      link: "text-button inline-flex items-center",
      unstyled: "",
    },
    size: {
      default: "",
      icon: "shrink-0",
    },
  },
  defaultVariants: {
    variant: "default",
    size: "default",
  },
});

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      type="button"
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
