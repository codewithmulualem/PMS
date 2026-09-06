import { useLayoutEffect, useRef, useState } from "react";
import PrototypeApp from "./App";

/* --------------------------------------------------------------------------
   EPA PMS — Multi-device prototype stage.
   Frames the same live prototype in phone / tablet / desktop devices so it
   can be demoed across form factors (and side by side). All frames share the
   auth/cycle/toast contexts from the parent providers, so signing in once
   populates every device with real data.
   -------------------------------------------------------------------------- */

const DEVICES = [
  { key: "phone-se", label: "Phone SE", kind: "phone", w: 375, h: 667 },
  { key: "phone", label: "Phone", kind: "phone", w: 393, h: 852 },
  { key: "tablet", label: "Tablet", kind: "tablet", w: 834, h: 1112 },
  { key: "desktop", label: "Desktop", kind: "desktop", w: 1280, h: 800 },
];

const COMPARE = ["phone", "tablet", "desktop"];

function useWindowWidth() {
  const [w, setW] = useState(
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  useLayoutEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return w;
}

function useStageWidth(ref) {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setW(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return w;
}

export default function MultiDeviceStage() {
  const windowWidth = useWindowWidth();

  // A genuinely small screen (real phone) skips the stage: the prototype runs
  // edge-to-edge like a native mobile app.
  if (windowWidth < 760) {
    return (
      <div className="proto-full-bleed">
        <PrototypeApp />
      </div>
    );
  }

  return <Stage />;
}

function Stage() {
  const stageRef = useRef(null);
  const stageWidth = useStageWidth(stageRef);
  const [single, setSingle] = useState("phone");
  const [compare, setCompare] = useState(false);
  const [rotated, setRotated] = useState(false);

  const singleDevice = DEVICES.find((d) => d.key === single);
  const dims = rotated && singleDevice.kind !== "desktop"
    ? { w: singleDevice.h, h: singleDevice.w }
    : { w: singleDevice.w, h: singleDevice.h };

  const singleScale = stageWidth
    ? Math.min(1, (stageWidth - 48) / dims.w)
    : 1;

  const compareSum = COMPARE.reduce(
    (acc, k) => acc + DEVICES.find((d) => d.key === k).w, 0
  );
  const compareScale = stageWidth
    ? Math.min(1, (stageWidth - 60 - (COMPARE.length - 1) * 24) / compareSum)
    : 1;

  return (
    <div className="dev-stage" ref={stageRef}>
      <div className="dev-bar">
        <div className="dev-title">EPA PMS · multi-device prototype</div>
        <span className="dev-spacer" />
        <div className="dev-controls">
          {!compare && (
            <div className="dev-group">
              {DEVICES.map((d) => (
                <button
                  key={d.key}
                  className={`dev-btn ${!compare && single === d.key ? "active" : ""}`}
                  onClick={() => setSingle(d.key)}
                >
                  {d.label}
                </button>
              ))}
            </div>
          )}
          <div className="dev-group">
            <button
              className={`dev-btn ${compare ? "active" : ""}`}
              onClick={() => setCompare((v) => !v)}
            >
              {compare ? "Single" : "Compare"}
            </button>
            {!compare && singleDevice.kind !== "desktop" && (
              <button
                className={`dev-btn ${rotated ? "active" : ""}`}
                onClick={() => setRotated((v) => !v)}
                title="Rotate device"
              >
                ↻ 90°
              </button>
            )}
          </div>
        </div>
      </div>

      {compare ? (
        <div className="dev-compare">
          {COMPARE.map((k) => (
            <DeviceFrame key={k} device={DEVICES.find((d) => d.key === k)} scale={Math.max(0.2, compareScale)} />
          ))}
        </div>
      ) : (
        <div className="dev-single">
          <DeviceFrame device={{ ...singleDevice, w: dims.w, h: dims.h }} scale={Math.max(0.2, singleScale)} />
        </div>
      )}
    </div>
  );
}

function DeviceFrame({ device, scale }) {
  return (
    <figure className="dev-frame-col">
      <div
        className="dev-scale"
        style={{ width: device.w * scale, height: device.h * scale }}
      >
        <div
          className={`dev-device dev-${device.kind}`}
          style={{ width: device.w, height: device.h, transform: `scale(${scale})`, transformOrigin: "top left" }}
        >
          {device.kind === "desktop" ? (
            <>
              <div className="dev-titlebar">
                <span className="dev-dot" style={{ background: "#ff5f57" }} />
                <span className="dev-dot" style={{ background: "#febc2e" }} />
                <span className="dev-dot" style={{ background: "#28c840" }} />
                <span className="dev-url">https://pms.epa.gov.et/prototype</span>
              </div>
              <div className="dev-screen">
                <PrototypeApp />
              </div>
            </>
          ) : (
            <>
              <div className="dev-notch" />
              <div className="dev-screen">
                <PrototypeApp />
              </div>
            </>
          )}
        </div>
      </div>
      <figcaption className="dev-caption">
        {device.label} · {device.w}×{device.h}
        {device.kind === "desktop" && " px"} {scale < 1 && ` · ${Math.round(scale * 100)}%`}
      </figcaption>
    </figure>
  );
}