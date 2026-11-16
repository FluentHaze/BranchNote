// Local builds default to the last verified public release; CI reads GitHub latest.
export const releaseVersion = import.meta.env.PUBLIC_RELEASE_VERSION || "0.2.6";
export const releaseTag = `v${releaseVersion}`;
export const releaseUrl = `https://github.com/FluentHaze/BranchNote/releases/tag/${releaseTag}`;
export const downloadUrl = `https://github.com/FluentHaze/BranchNote/releases/download/${releaseTag}`;
