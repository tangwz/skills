export type VideoBrand = {
  channelName: string | null;
  logoPath: string | null;
  tagline: string | null;
  endNote: string | null;
};

export const VIDEO_BRAND: VideoBrand = {
  channelName: null,
  logoPath: null,
  tagline: null,
  endNote: null,
};

export const resolveVideoBrand = (
  overrides: Partial<VideoBrand> = {},
): VideoBrand => ({
  ...VIDEO_BRAND,
  ...overrides,
});
