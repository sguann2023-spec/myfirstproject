import React from "react";
import { Package } from "lucide-react";
import { inferProviderLogoKey, resolveProviderLogo } from "../shared/providerBranding.js";

// Keying the image state by source resets failures on a brand change and isolates
// late error events from the previous image. No provider endpoint is needed here.
function LogoImage({ src, size, className, style }) {
  const [failed, setFailed] = React.useState(false);
  if (!src || failed) {
    return <Package size={size} className={className} style={style} aria-hidden="true" />;
  }
  return (
    <img
      src={src}
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: "contain", ...style }}
      onError={() => setFailed(true)}
    />
  );
}

export function ProviderLogo({ logoKey, name, size = 22, className, style }) {
  const src = resolveProviderLogo(undefined, inferProviderLogoKey({ logoKey, name }));
  return <LogoImage key={src || "fallback"} src={src} size={size} className={className} style={style} />;
}
