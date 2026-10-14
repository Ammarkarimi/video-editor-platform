import type { TextStyle } from '../model/schema.js';
import { colorAlpha, toCssColor } from '../util/color.js';
import { roundRectPath } from './paths.js';
import type { Ctx2D } from './types.js';

export interface TextLine {
  text: string;
  width: number;
}

export interface TextLayout {
  font: string;
  letterSpacing: number;
  lines: TextLine[];
  lineHeight: number;
  ascent: number;
  descent: number;
  /** Size of the text block (project pixels). */
  textWidth: number;
  textHeight: number;
  /** Background padding (0 when the background box is transparent). */
  padding: number;
  /** Size of the visual box including padding. */
  boxWidth: number;
  boxHeight: number;
  totalChars: number;
}

export function fontString(
  style: Pick<TextStyle, 'fontFamily' | 'fontSize' | 'fontWeight' | 'italic'>,
): string {
  const family = style.fontFamily.replace(/["\\]/g, '');
  return `${style.italic ? 'italic ' : ''}${style.fontWeight} ${style.fontSize}px "${family}", sans-serif`;
}

function supportsLetterSpacing(ctx: Ctx2D): boolean {
  return 'letterSpacing' in ctx;
}

function applyFont(ctx: Ctx2D, font: string, letterSpacing: number): void {
  ctx.font = font;
  if (supportsLetterSpacing(ctx)) ctx.letterSpacing = `${letterSpacing}px`;
}

function measure(ctx: Ctx2D, text: string): number {
  return text.length === 0 ? 0 : ctx.measureText(text).width;
}

function breakLongWord(ctx: Ctx2D, word: string, maxWidth: number): string[] {
  const parts: string[] = [];
  let current = '';
  for (const ch of word) {
    if (current && measure(ctx, current + ch) > maxWidth) {
      parts.push(current);
      current = ch;
    } else {
      current += ch;
    }
  }
  if (current) parts.push(current);
  return parts;
}

function wrapParagraph(ctx: Ctx2D, paragraph: string, maxWidth: number): string[] {
  if (maxWidth <= 0 || measure(ctx, paragraph) <= maxWidth) return [paragraph];
  const tokens = paragraph.split(/(\s+)/).filter((t) => t.length > 0);
  const lines: string[] = [];
  let current = '';
  for (const token of tokens) {
    const isSpace = /^\s+$/.test(token);
    if (isSpace) {
      if (current) current += token;
      continue;
    }
    const candidate = current + token;
    if (measure(ctx, candidate.trimEnd()) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current.trim()) lines.push(current.trimEnd());
    if (measure(ctx, token) > maxWidth) {
      const pieces = breakLongWord(ctx, token, maxWidth);
      lines.push(...pieces.slice(0, -1));
      current = pieces[pieces.length - 1] ?? '';
    } else {
      current = token;
    }
  }
  if (current.trim() || lines.length === 0) lines.push(current.trimEnd());
  return lines;
}

/**
 * Lays out a text block with the given context's font metrics. Mutates the context's font state.
 * All dimensions are in project pixels.
 */
export function layoutText(ctx: Ctx2D, text: string, style: TextStyle): TextLayout {
  const font = fontString(style);
  const letterSpacing = supportsLetterSpacing(ctx) ? style.letterSpacing : 0;
  applyFont(ctx, font, letterSpacing);
  const content = style.uppercase ? text.toUpperCase() : text;
  const rawLines = content
    .split(/\r?\n/)
    .flatMap((paragraph) => wrapParagraph(ctx, paragraph, style.maxWidth));
  const lines = rawLines.map((line) => ({ text: line, width: measure(ctx, line) }));
  const metrics = ctx.measureText('Hg');
  const ascent = metrics.fontBoundingBoxAscent ?? style.fontSize * 0.8;
  const descent = metrics.fontBoundingBoxDescent ?? style.fontSize * 0.2;
  const lineHeight = style.fontSize * style.lineHeight;
  const textWidth = Math.max(0, ...lines.map((l) => l.width));
  const textHeight = lines.length * lineHeight;
  const padding = colorAlpha(style.backgroundColor) > 0 ? style.backgroundPadding : 0;
  return {
    font,
    letterSpacing,
    lines,
    lineHeight,
    ascent,
    descent,
    textWidth,
    textHeight,
    padding,
    boxWidth: textWidth + padding * 2,
    boxHeight: textHeight + padding * 2,
    totalChars: lines.reduce((sum, l) => sum + [...l.text].length, 0),
  };
}

export interface DrawTextOptions {
  /** 0..1 fraction of characters revealed (typewriter). */
  reveal: number;
  /**
   * Device pixels per project pixel at this point (output scale times clip scale). Shadow
   * parameters are not affected by the canvas transform, so they are scaled manually.
   */
  shadowScale: number;
}

/** Draws a laid-out text block centered on the origin of the current transform. */
export function drawTextBlock(
  ctx: Ctx2D,
  layout: TextLayout,
  style: TextStyle,
  options: DrawTextOptions,
): void {
  if (colorAlpha(style.backgroundColor) > 0) {
    ctx.fillStyle = toCssColor(style.backgroundColor);
    ctx.beginPath();
    roundRectPath(
      ctx,
      -layout.boxWidth / 2,
      -layout.boxHeight / 2,
      layout.boxWidth,
      layout.boxHeight,
      style.backgroundRadius,
    );
    ctx.fill();
  }

  applyFont(ctx, layout.font, layout.letterSpacing);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';

  const hasShadow =
    colorAlpha(style.shadowColor) > 0 &&
    (style.shadowBlur > 0 || style.shadowOffsetX !== 0 || style.shadowOffsetY !== 0);
  const setShadow = (on: boolean) => {
    if (on) {
      ctx.shadowColor = toCssColor(style.shadowColor);
      ctx.shadowBlur = style.shadowBlur * options.shadowScale;
      ctx.shadowOffsetX = style.shadowOffsetX * options.shadowScale;
      ctx.shadowOffsetY = style.shadowOffsetY * options.shadowScale;
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0)';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
    }
  };

  const hasStroke = style.strokeWidth > 0 && colorAlpha(style.strokeColor) > 0;
  let remaining = Math.round(Math.min(1, Math.max(0, options.reveal)) * layout.totalChars);
  const top = -layout.textHeight / 2;
  const glyphHeight = layout.ascent + layout.descent;

  for (let i = 0; i < layout.lines.length; i++) {
    if (remaining <= 0) break;
    const line = layout.lines[i]!;
    const chars = [...line.text];
    const visible = remaining >= chars.length ? line.text : chars.slice(0, remaining).join('');
    remaining -= chars.length;
    if (!visible) continue;

    let x: number;
    if (style.align === 'left') x = -layout.textWidth / 2;
    else if (style.align === 'right') x = layout.textWidth / 2 - line.width;
    else x = -line.width / 2;
    const y = top + i * layout.lineHeight + (layout.lineHeight - glyphHeight) / 2 + layout.ascent;

    if (hasStroke) {
      setShadow(hasShadow);
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.lineJoin = 'round';
      ctx.strokeStyle = toCssColor(style.strokeColor);
      ctx.strokeText(visible, x, y);
      setShadow(false);
    } else {
      setShadow(hasShadow);
    }
    ctx.fillStyle = toCssColor(style.color);
    ctx.fillText(visible, x, y);
    setShadow(false);
  }
}
