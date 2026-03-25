/**
 * ThumbnailCropper — modal overlay for cropping images to 200x200 JPEG.
 *
 * Shows the image with a square crop area the user can pan/pinch to position.
 * "Save" crops via canvas, "Cancel" dismisses.
 *
 * Uses FileReader to load the image as a data URL for maximum compatibility
 * across browsers and Capacitor WebView.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { hapticTap } from '../lib/platform/haptics';

interface ThumbnailCropperProps {
  /** The image file to crop. */
  file: File;
  /** Called with base64 JPEG (no data: prefix) on save. */
  onSave: (base64: string) => void;
  /** Called when the user cancels. */
  onCancel: () => void;
}

const CROP_SIZE = 200;
const PREVIEW_SIZE = 250;

/**
 * Modal overlay for cropping an image to a square thumbnail.
 *
 * @param file     - Image file to crop.
 * @param onSave   - Callback with cropped base64 JPEG.
 * @param onCancel - Callback on dismiss.
 */
export function ThumbnailCropper({ file, onSave, onCancel }: ThumbnailCropperProps) {
  const [imgSrc, setImgSrc] = useState('');
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const [loading, setLoading] = useState(true);
  const dragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Load image via FileReader (works reliably on iOS/Capacitor)
  useEffect(() => {
    setLoading(true);
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setImgSrc(dataUrl);

      const img = new Image();
      img.onload = () => {
        setImgEl(img);
        // Fit image so shortest side fills the preview
        const minDim = Math.min(img.width, img.height);
        const s = PREVIEW_SIZE / minDim;
        setScale(s);
        setOffset({
          x: (PREVIEW_SIZE - img.width * s) / 2,
          y: (PREVIEW_SIZE - img.height * s) / 2,
        });
        setLoading(false);
      };
      img.onerror = () => setLoading(false);
      img.src = dataUrl;
    };
    reader.onerror = () => setLoading(false);
    reader.readAsDataURL(file);
  }, [file]);

  // Pan handling
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, origX: offset.x, origY: offset.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [offset]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setOffset({ x: dragRef.current.origX + dx, y: dragRef.current.origY + dy });
  }, []);

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
  }, []);

  // Pinch/wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale(prev => Math.max(0.1, Math.min(5, prev - e.deltaY * 0.002)));
  }, []);

  // Crop and save
  const handleSave = useCallback(() => {
    if (!imgEl) return;
    hapticTap();

    const canvas = document.createElement('canvas');
    canvas.width = CROP_SIZE;
    canvas.height = CROP_SIZE;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Map preview offset/scale back to source image coordinates
    const srcX = -offset.x / scale;
    const srcY = -offset.y / scale;
    const srcW = PREVIEW_SIZE / scale;
    const srcH = PREVIEW_SIZE / scale;

    ctx.drawImage(imgEl, srcX, srcY, srcW, srcH, 0, 0, CROP_SIZE, CROP_SIZE);

    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    const base64 = dataUrl.split(',')[1] ?? '';
    onSave(base64);
  }, [imgEl, offset, scale, onSave]);

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center"
      style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="bg-[#FDFBF7] dark:bg-[#1A1A1A] rounded-xl overflow-hidden w-[300px] flex flex-col">
        {/* Preview area */}
        <div
          className="relative overflow-hidden mx-auto mt-4 bg-[#F0F0F0] dark:bg-[var(--kit-bg)]"
          style={{ width: PREVIEW_SIZE, height: PREVIEW_SIZE, touchAction: 'none' }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        >
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-6 h-6 border-2 border-[#C4C4C4] border-t-transparent rounded-full animate-spin" />
            </div>
          )}
          {imgSrc && (
            <img
              src={imgSrc}
              alt="Crop preview"
              draggable={false}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                maxWidth: 'none',
                pointerEvents: 'none',
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: '0 0',
              }}
            />
          )}
          {/* Crop overlay grid lines */}
          <div className="absolute inset-0 border-2 border-white/50 pointer-events-none" />
        </div>

        {/* Zoom hint */}
        <p className="text-xs text-[#C4C4C4] text-center mt-2">Drag to reposition</p>

        {/* Zoom slider */}
        <div className="px-6 mt-2">
          <input
            type="range"
            min="0.1"
            max="3"
            step="0.05"
            value={scale}
            onChange={(e) => setScale(Number(e.target.value))}
            className="w-full accent-[#1c1c1e] dark:accent-[#E5E5E5]"
          />
        </div>

        {/* Buttons */}
        <div className="flex gap-3 p-4">
          <button
            onClick={() => { hapticTap(); onCancel(); }}
            className="flex-1 py-2 text-sm text-[#C4C4C4] border border-[#D4D4D4] dark:border-[#404040] rounded-lg"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={loading || !imgEl}
            className="flex-1 py-2 text-sm font-semibold bg-[#1c1c1e] dark:bg-[#E5E5E5] text-white dark:text-[#0A0A0A] rounded-lg active:opacity-80 disabled:opacity-40"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
