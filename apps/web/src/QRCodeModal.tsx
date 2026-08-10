import { useEffect, useRef } from "react";
import QRCode from "qrcode";

interface QRCodeModalProps {
  url: string;
  onClose: () => void;
}

export function QRCodeModal({ url, onClose }: QRCodeModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // Generate QR code
    QRCode.toCanvas(canvas, url, {
      width: 300,
      margin: 2,
      color: {
        dark: "#2B2118",
        light: "#F4EAD5",
      },
      errorCorrectionLevel: "L",
    }, (error) => {
      if (error) {
        console.error("Failed to generate QR code:", error);
      }
    });
  }, [url]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qr-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(43, 33, 24, 0.8)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#F4EAD5",
          borderRadius: 16,
          padding: 24,
          maxWidth: 400,
          width: "100%",
          boxShadow: "0 8px 32px rgba(0,0,0,0.3)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <h3
          id="qr-title"
          style={{
            margin: 0,
            fontSize: 20,
            color: "#2B2118",
            textAlign: "center",
          }}
        >
          Scan to Challenge Me!
        </h3>

        <canvas
          ref={canvasRef}
          style={{
            border: "3px solid #2B2118",
            borderRadius: 8,
            backgroundColor: "#F4EAD5",
          }}
          aria-label="QR code containing challenge link"
        />

        <p
          style={{
            margin: 0,
            fontSize: 14,
            color: "#6E5F48",
            textAlign: "center",
            lineHeight: 1.5,
          }}
        >
          Point your camera at this QR code to race against my run!
        </p>

        <button
          onClick={onClose}
          aria-label="Close QR code"
          style={{
            padding: "12px 24px",
            fontSize: 16,
            fontWeight: 600,
            fontFamily: "inherit",
            backgroundColor: "#D94F3A",
            color: "#2B2118",
            border: "2px solid #2B2118",
            borderRadius: 8,
            cursor: "pointer",
            width: "100%",
          }}
        >
          Close
        </button>
      </div>
    </div>
  );
}
