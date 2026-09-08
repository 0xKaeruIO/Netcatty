import React from "react";
import { cn } from "../lib/utils";

interface AppLogoProps {
  className?: string;
}

export const AppLogo: React.FC<AppLogoProps> = ({ className }) => (
  <img
    src="/icon-win.png"
    alt="Netcatty"
    draggable={false}
    className={cn("select-none object-contain", className)}
  />
);

export default AppLogo;
