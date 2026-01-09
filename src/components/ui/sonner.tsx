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
            "group toast group-[.toaster]:bg-[hsl(220,18%,10%)] group-[.toaster]:text-foreground group-[.toaster]:border-cyan-500/30 group-[.toaster]:shadow-[0_0_15px_rgba(0,255,255,0.15)] group-[.toaster]:font-mono",
          description: "group-[.toast]:text-cyan-300/70",
          actionButton: "group-[.toast]:bg-cyan-500 group-[.toast]:text-white",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
          error: "group-[.toaster]:!bg-[hsl(220,18%,10%)] group-[.toaster]:!border-red-500/40 group-[.toaster]:!text-red-300 group-[.toaster]:!shadow-[0_0_15px_rgba(255,80,80,0.15)]",
          success: "group-[.toaster]:!bg-[hsl(220,18%,10%)] group-[.toaster]:!border-cyan-500/40 group-[.toaster]:!text-cyan-300 group-[.toaster]:!shadow-[0_0_15px_rgba(0,255,255,0.2)]",
          warning: "group-[.toaster]:!bg-[hsl(220,18%,10%)] group-[.toaster]:!border-yellow-500/40 group-[.toaster]:!text-yellow-300 group-[.toaster]:!shadow-[0_0_15px_rgba(255,200,0,0.15)]",
          info: "group-[.toaster]:!bg-[hsl(220,18%,10%)] group-[.toaster]:!border-cyan-500/40 group-[.toaster]:!text-cyan-300 group-[.toaster]:!shadow-[0_0_15px_rgba(0,255,255,0.2)]",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
