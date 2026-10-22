import { unavailableProvider } from "./operations.mjs";
export function createSelfHostedProvider({
  media,
  env = process.env,
  fetcher = fetch,
}) {
  const base = env.GAES_FACE_SERVICE_URL || "",
    key = env.GAES_FACE_SERVICE_KEY || "";
  let url;
  try {
    url = new URL(base);
  } catch {
    return unavailableProvider;
  }
  if (
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      )) ||
    key.length < 32
  )
    return unavailableProvider;
  const call = async (path, input, signal) => {
    const response = await fetcher(new URL(path, url), {
      method: "POST",
      redirect: "error",
      signal: signal || AbortSignal.timeout(8000),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(input),
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error("FACE_ENGINE_UNAVAILABLE"), {
        code: [
          "EXACTLY_ONE_FACE_REQUIRED",
          "FACE_TOO_SMALL",
          "PHOTO_BLURRED",
          "INCONSISTENT_ENROLLMENT",
        ].includes(data.error)
          ? data.error
          : "IDENTITY_NOT_CONNECTED",
        status: 503,
      });
    return data;
  };
  return {
    ...unavailableProvider,
    configured: true,
    livenessConfigured: false,
    async health() {
      return (await call("/health", {})).ready === true;
    },
    async detect({ capture, signal }) {
      return call("/detect", { capture }, signal);
    },
    async enroll({ subjectKey, photos, signal }) {
      const images = [];
      for (const photo of photos) {
        const image = await media.read(photo.path);
        images.push(
          `data:${image.contentType};base64,${image.bytes.toString("base64")}`,
        );
      }
      return call("/enroll", { subjectKey, photos: images }, signal);
    },
    async verifyOneToOne({
      subjectKey,
      referenceId,
      sessionId,
      capture,
      signal,
    }) {
      return call(
        "/verify",
        {
          subjectKey,
          referenceId,
          sessionId,
          capture: `data:${capture.contentType};base64,${capture.bytes.toString("base64")}`,
        },
        signal,
      );
    },
  };
}
