import { useEffect, useState } from "react";
import {
  cancelRender,
  continueRender,
  delayRender,
  staticFile,
} from "remotion";

export const clipFontFamily = "Clip Inter";

export const useClipFont = () => {
  const [handle] = useState(() => delayRender("Load the supplied clip font"));
  useEffect(() => {
    const font = new FontFace(
      clipFontFamily,
      `url("${staticFile("fonts/inter-latin-500-normal.woff2")}")`,
      { weight: "500" },
    );
    let active = true;
    font.load().then(
      (loaded) => {
        document.fonts.add(loaded);
        if (active) continueRender(handle);
      },
      (error: unknown) => {
        if (active) cancelRender(error);
      },
    );
    return () => {
      active = false;
      continueRender(handle);
    };
  }, [handle]);
};
