"use client";

import Script from "next/script";
import { useEffect, useRef } from "react";

type BeerForCan = {
  name: string;
};

type BeerCan3DProps = {
  beer: BeerForCan;
};

type MaterialTexture = unknown;
type TextureInfo = {
  setTexture: (texture: MaterialTexture | null) => void;
};
type MaterialPbr = {
  setBaseColorFactor: (value: [number, number, number, number]) => void;
  setMetallicFactor: (value: number) => void;
  setRoughnessFactor: (value: number) => void;
  baseColorTexture?: TextureInfo | null;
  setBaseColorTexture?: (texture: MaterialTexture | null) => void;
};
type ModelMaterial = {
  name?: string;
  pbrMetallicRoughness?: MaterialPbr;
};
type ModelViewerWithSceneGraph = {
  model?: { materials?: ModelMaterial[] };
  createTexture?: (uri: string) => Promise<MaterialTexture>;
  addEventListener: (type: string, listener: () => void) => void;
  removeEventListener: (type: string, listener: () => void) => void;
};

const MODEL_SRC = "/models/Puszka_Tomek.glb";
const ModelViewer = "model-viewer" as unknown as React.ElementType;

const READY_LABEL_DIR = "/models/etykiety clean";
const LABEL_FILE_BY_KEY: Record<string, string> = {
  tatra: "tatra.png",
  zywiec: "zywiec.png",
  warka: "warka.png",
  lech: "lech.png",
  lomza: "lomza.png",
  omza: "lomza.png",
  tyskie: "tyskie.png",
  perla: "perla.png",
  pera: "perla.png",
  okocim: "okocim.png",
  harnas: "harnas.png",
  kasztelan: "kasztelan.png",
  ksiazece: "ksiazece.png",
  krolewskie: "krolewskie.png",
  namyslow: "namyslow.png",
  namysow: "namyslow.png",
  desperados: "desperados.png",
  heineken: "heineken.png",
  carlsberg: "carlsberg.png",
  zubr: "zubr.png",
  debowe: "debowe.png",
  specjal: "specjal.png",
  eb: "eb.png",
  captainjack: "capjack.png",
  guinness: "guinness.png",
  kozel: "kozel.png",
  pilsnerurquell: "pilsner.png",
  budweiser: "budweiser.png",
  budlight: "budlight.png",
  becks: "becks.png",
  paulaner: "paulaner.png",
  superbock: "super bock.png",
  perlenbacher: "perlenbacher.png",
  argus: "argus.png",
  kustosz: "kustosz.png",
  karpackie: "karpackie.png",
  romper: "romper.png",
  brok: "brok.png",
};
const LABEL_DRAW_SCALE_BY_KEY: Record<string, number> = {};
const LABEL_CROP_ANCHOR_Y_BY_KEY: Record<string, number> = {};

function buildLabelPath(dir: string, file: string): string {
  return `${dir}/${encodeURIComponent(file)}`;
}

function normalizeBeerKey(value: string): string {
  return value
    .replace(/[łŁ]/g, "l")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2019'`\u00B4]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function resolveLabelPath(beerName: string): string | null {
  const direct = LABEL_FILE_BY_KEY[normalizeBeerKey(beerName)];
  if (direct) return buildLabelPath(READY_LABEL_DIR, direct);

  const normalized = normalizeBeerKey(beerName);
  for (const [key, file] of Object.entries(LABEL_FILE_BY_KEY)) {
    if (normalized.includes(key)) return buildLabelPath(READY_LABEL_DIR, file);
  }
  return null;
}

function resolveLabelDrawScale(beerName: string): number {
  const normalized = normalizeBeerKey(beerName);
  const direct = LABEL_DRAW_SCALE_BY_KEY[normalized];
  if (typeof direct === "number") return direct;

  for (const [key, scale] of Object.entries(LABEL_DRAW_SCALE_BY_KEY)) {
    if (normalized.includes(key)) return scale;
  }
  return 1;
}

function resolveLabelCropAnchorY(beerName: string): number {
  const normalized = normalizeBeerKey(beerName);
  const direct = LABEL_CROP_ANCHOR_Y_BY_KEY[normalized];
  if (typeof direct === "number") return direct;

  for (const [key, anchor] of Object.entries(LABEL_CROP_ANCHOR_Y_BY_KEY)) {
    if (normalized.includes(key)) return anchor;
  }
  return 0.5;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image_load_failed:${src}`));
    img.src = src;
  });
}

async function createCanWrapTexture(beerName: string): Promise<string> {
  const width = 2048;
  const height = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  const metal = ctx.createLinearGradient(0, 0, 0, height);
  metal.addColorStop(0, "#cfd3d8");
  metal.addColorStop(0.22, "#f3f4f5");
  metal.addColorStop(0.52, "#b9bfc8");
  metal.addColorStop(0.8, "#9ea6b0");
  metal.addColorStop(1, "#808993");
  ctx.fillStyle = metal;
  ctx.fillRect(0, 0, width, height);

  for (let x = 0; x < width; x += 56) {
    const alpha = x % 112 === 0 ? 0.14 : 0.08;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, 0, 4, height);
  }

  const labelPath = resolveLabelPath(beerName);
  let labelImage: HTMLImageElement | null = null;

  if (labelPath) {
    try {
      labelImage = await loadImage(labelPath);
    } catch {
      labelImage = null;
    }
  }

  const bandTop = Math.round(height * 0.03);
  const bandHeight = Math.round(height * 0.46);
  const labelDrawScale = Math.max(0.2, Math.min(1, resolveLabelDrawScale(beerName)));
  const labelCropAnchorY = Math.max(0, Math.min(1, resolveLabelCropAnchorY(beerName)));
  const drawWidth = Math.round(width * labelDrawScale);
  const drawX = Math.round((width - drawWidth) / 2);

  if (labelImage) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 3;
    ctx.filter = "saturate(1.02) contrast(1.01)";

    const scaleToWidth = drawWidth / labelImage.width;
    const targetH = labelImage.height * scaleToWidth;

    if (targetH >= bandHeight) {
      const srcH = Math.max(1, bandHeight / scaleToWidth);
      const srcY = Math.max(0, (labelImage.height - srcH) * labelCropAnchorY);
      ctx.drawImage(labelImage, 0, srcY, labelImage.width, srcH, drawX, bandTop, drawWidth, bandHeight);
    } else {
      const destY = bandTop + (bandHeight - targetH) / 2;
      ctx.drawImage(labelImage, 0, 0, labelImage.width, labelImage.height, drawX, destY, drawWidth, targetH);
    }
    ctx.restore();
  } else {
    ctx.fillStyle = "rgba(24, 24, 24, 0.8)";
    ctx.font = "700 96px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(beerName, width / 2, bandTop + bandHeight / 2);
  }

  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(0, 70, width, 28);
  ctx.fillStyle = "rgba(52,63,76,0.2)";
  ctx.fillRect(0, height - 110, width, 26);

  const sideShade = ctx.createLinearGradient(0, 0, width, 0);
  sideShade.addColorStop(0, "rgba(0,0,0,0.32)");
  sideShade.addColorStop(0.18, "rgba(0,0,0,0.12)");
  sideShade.addColorStop(0.5, "rgba(255,255,255,0.12)");
  sideShade.addColorStop(0.82, "rgba(0,0,0,0.12)");
  sideShade.addColorStop(1, "rgba(0,0,0,0.3)");
  ctx.fillStyle = sideShade;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(width * 0.47, 0, width * 0.05, height);

  return canvas.toDataURL("image/png");
}

export default function BeerCan3D({ beer }: BeerCan3DProps) {
  const modelRef = useRef<ModelViewerWithSceneGraph | null>(null);

  useEffect(() => {
    const viewer = modelRef.current;
    if (!viewer) return;
    let cancelled = false;

    const applyMaterial = async () => {
      const materials = viewer.model?.materials ?? [];
      if (materials.length === 0) return;

      const wrapUrl = await createCanWrapTexture(beer.name);
      if (cancelled) return;

      const texture = viewer.createTexture ? await viewer.createTexture(wrapUrl) : null;
      if (cancelled) return;

      for (const material of materials) {
        const pbr = material?.pbrMetallicRoughness;
        if (!pbr) continue;

        pbr.setBaseColorFactor([1, 1, 1, 1]);
        pbr.setMetallicFactor(0.9);
        pbr.setRoughnessFactor(0.31);
        if (texture) {
          if (pbr.baseColorTexture) {
            pbr.baseColorTexture.setTexture(texture);
          } else if (pbr.setBaseColorTexture) {
            pbr.setBaseColorTexture(texture);
          }
        }
      }
    };

    const onLoad = () => {
      void applyMaterial();
    };

    viewer.addEventListener("load", onLoad);
    if (viewer.model) {
      void applyMaterial();
    }

    return () => {
      cancelled = true;
      viewer.removeEventListener("load", onLoad);
    };
  }, [beer.name]);

  return (
    <div className="beer3d-scene beer3d-model-scene">
      <Script
        src="https://unpkg.com/@google/model-viewer/dist/model-viewer.min.js"
        strategy="afterInteractive"
        type="module"
      />
      <div className="beer3d-model-wrap" aria-hidden>
        <ModelViewer
          ref={modelRef}
          className="beer3d-model"
          src={MODEL_SRC}
          alt={`Model puszki: ${beer.name}`}
          camera-controls
          auto-rotate
          auto-rotate-delay="0"
          rotation-per-second="20deg"
          camera-orbit="0deg 78deg 102%"
          min-camera-orbit="auto 65deg auto"
          max-camera-orbit="auto 95deg auto"
          interaction-prompt="none"
          environment-image="neutral"
          exposure="0.9"
          shadow-intensity="0.28"
          shadow-softness="1.15"
          disable-tap
          disable-zoom
        />
      </div>
    </div>
  );
}
