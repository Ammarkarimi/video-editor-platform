import { colorAlpha, defaultTextStyle, TEXT_PRESETS, toCssColor, type TextPreset } from '@vep/core';
import { Plus } from 'lucide-react';
import { useEffect, type CSSProperties } from 'react';
import { fontLoader } from '../engine/fonts';
import { addTextClip } from '../actions';
import { DRAG_MIME, setDragPayload } from '../timeline/constants';
import { PanelHeader } from './LeftPanel';

function presetCss(preset: TextPreset): CSSProperties {
  const style = defaultTextStyle(preset.style);
  const scale = 22 / Math.max(48, style.fontSize);
  const css: CSSProperties = {
    fontFamily: `"${style.fontFamily}", sans-serif`,
    fontWeight: style.fontWeight,
    fontStyle: style.italic ? 'italic' : 'normal',
    fontSize: Math.max(13, Math.min(26, style.fontSize * scale * 2.2)),
    color: toCssColor(style.color),
    textTransform: style.uppercase ? 'uppercase' : 'none',
    lineHeight: 1.15,
    letterSpacing: style.letterSpacing * scale,
    whiteSpace: 'pre-line',
    textAlign: style.align,
  };
  if (style.strokeWidth > 0)
    css.WebkitTextStroke = `${Math.max(1, style.strokeWidth * scale)}px ${toCssColor(style.strokeColor)}`;
  if (style.shadowBlur > 0 || style.shadowOffsetY !== 0) {
    css.textShadow = `${style.shadowOffsetX * scale}px ${style.shadowOffsetY * scale}px ${style.shadowBlur * scale}px ${toCssColor(style.shadowColor)}`;
  }
  if (colorAlpha(style.backgroundColor) > 0) {
    css.background = toCssColor(style.backgroundColor);
    css.padding = '4px 8px';
    css.borderRadius = 4;
  }
  return css;
}

export function TextPanel() {
  useEffect(() => {
    for (const preset of TEXT_PRESETS) fontLoader.ensureFamily(preset.style.fontFamily ?? 'Inter');
  }, []);

  return (
    <div>
      <PanelHeader title="Text" />
      <div className="space-y-2 p-3">
        <button
          type="button"
          onClick={() => addTextClip()}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-line-2 py-3 text-xs text-muted hover:border-accent hover:text-fg"
        >
          <Plus size={14} /> Add plain text
        </button>
        <p className="pt-2 text-[11px] font-semibold tracking-wide text-dim uppercase">Styles</p>
        <div className="grid grid-cols-2 gap-2">
          {TEXT_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              draggable
              data-testid={`text-preset-${preset.id}`}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  DRAG_MIME,
                  JSON.stringify({ kind: 'text', presetId: preset.id }),
                );
                event.dataTransfer.effectAllowed = 'copy';
                setDragPayload({ kind: 'text', presetId: preset.id });
              }}
              onDragEnd={() => setDragPayload(null)}
              onClick={() => addTextClip(preset)}
              title={`Add "${preset.label}" at the playhead`}
              className="group flex aspect-[4/3] flex-col overflow-hidden rounded-lg border border-line bg-gradient-to-br from-[#1b2030] to-[#121620] text-left hover:border-accent"
            >
              <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
                <span className="max-w-full truncate" style={presetCss(preset)}>
                  {preset.text.split('\n')[0]}
                </span>
              </div>
              <span className="border-t border-line bg-black/20 px-2 py-1 text-[11px] text-muted group-hover:text-fg">
                {preset.label}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
