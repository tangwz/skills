import { Composition, registerRoot } from "remotion";
import { LongTitleEpisode, SignalEpisode } from "./Episodes";
import { videoSettings } from "./video-settings";

const Root = () => (
  <>
    <Composition
      id="SignalEpisode"
      component={SignalEpisode}
      {...videoSettings}
    />
    <Composition
      id="LongTitleEpisode"
      component={LongTitleEpisode}
      {...videoSettings}
    />
  </>
);

registerRoot(Root);
