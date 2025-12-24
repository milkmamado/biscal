import { useTheme } from "next-themes";
import { Toaster as Sonner, toast } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme();

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      position="bottom-left"
      duration={4000}
      closeButton
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:!bg-red-950 group-[.toaster]:!border-red-500/50 group-[.toaster]:!text-red-100",
          success: "group-[.toaster]:!bg-green-950 group-[.toaster]:!border-green-500/50 group-[.toaster]:!text-green-100",
          warning: "group-[.toaster]:!bg-yellow-950 group-[.toaster]:!border-yellow-500/50 group-[.toaster]:!text-yellow-100",
          info: "group-[.toaster]:!bg-cyan-950 group-[.toaster]:!border-cyan-500/50 group-[.toaster]:!text-cyan-100",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
