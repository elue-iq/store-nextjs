"use client";

import jsQR from "jsqr";
import { useEffect, useRef, useState } from "react";

type Detector = { detect: (src: CanvasImageSource) => Promise<{ rawValue: string }[]> };

// A full-screen camera that reads one QR code (the label's), then calls onCode.
// Uses the phone's own detector when it has one, and jsQR otherwise (iPhone).
export function CourierScanner({ onCode, onClose }: { onCode: (text: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer = 0;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        const v = video.current;
        if (!v || stopped) return;
        v.srcObject = stream;
        await v.play();
        const BD = (window as unknown as { BarcodeDetector?: new (o: { formats: string[] }) => Detector }).BarcodeDetector;
        const detector = BD ? new BD({ formats: ["qr_code"] }) : null;
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = async () => {
          if (stopped) return;
          if (v.videoWidth) {
            let text = "";
            try {
              if (detector) text = (await detector.detect(v))[0]?.rawValue ?? "";
              else {
                canvas.width = v.videoWidth;
                canvas.height = v.videoHeight;
                ctx.drawImage(v, 0, 0);
                const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
                text = jsQR(img.data, img.width, img.height)?.data ?? "";
              }
            } catch {
              // keep trying
            }
            if (text) {
              stopped = true;
              onCode(text);
              return;
            }
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch {
        setError("تعذّر فتح الكاميرا. اسمح للموقع بالكاميرا، أو اكتب رقم الطلب يدوياً.");
      }
    })();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onCode]);

  return (
    <div className="scanner" role="dialog" aria-label="مسح QR">
      <video ref={video} playsInline muted />
      <div className="scanner__frame" aria-hidden="true" />
      <p className="scanner__hint">{error || "وجّه الكاميرا نحو QR على الملصق"}</p>
      <button type="button" className="btn btn--full scanner__close" onClick={onClose}>
        إغلاق
      </button>
    </div>
  );
}
