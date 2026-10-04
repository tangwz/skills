import { Composition, registerRoot } from "remotion";
import { clipSettings } from "./clip-settings";
import { MechanismSection } from "./MechanismSection";

const Root = () => (
  <Composition
    id="MechanismSection"
    component={MechanismSection}
    {...clipSettings}
  />
);

registerRoot(Root);
