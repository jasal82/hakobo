// Gerenderte Markdown-Notiz mit Wiki-Links, Tags und hervorgehobenem Code.

import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { enhance, renderMarkdown } from '../lib/markdown';
import { isPerson, linkLabel, resolveKey } from '../lib/links';
import { store, useStore } from '../lib/store';
import type { Node } from '../lib/types';
import { openExternal, openTag } from './RichText';

export const Markdown = memo(function Markdown({ text, source, className, onClick }: { text: string; source?: Node; className?: string; onClick?: (e: React.MouseEvent) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  // Nur Notizen mit Links hängen von anderen Knoten ab.
  const nodes = useStore((s) => (text.includes('[[') ? s.nodes : null));
  const html = useMemo(() => renderMarkdown(text), [text]);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.innerHTML = html;
    enhance(el, {
      link: (key, alias, target) => {
        const all = nodes ?? store().nodes;
        const id = resolveKey(all, source, key);
        return { id, label: linkLabel(all, id, alias, target), person: isPerson(id ? all[id] : undefined) };
      },
    });
  }, [html, nodes, source]);
  return (
    <div
      ref={ref}
      className={`md ${className ?? ''}`}
      onClick={(e) => {
        const copy = (e.target as HTMLElement).closest('.md-copy');
        if (copy) {
          e.preventDefault();
          e.stopPropagation();
          const code = copy.parentElement?.querySelector('code')?.textContent ?? '';
          void navigator.clipboard.writeText(code).then(
            () => store().toast('Code kopiert', 'success'),
            () => store().toast('Kopieren nicht möglich', 'error'),
          );
          return;
        }
        const a = (e.target as HTMLElement).closest('a') as HTMLAnchorElement | null;
        if (a) {
          e.preventDefault();
          e.stopPropagation();
          if (a.dataset.id) store().reveal(a.dataset.id);
          else if (a.dataset.tag) openTag(a.dataset.tag);
          else if (a.href) openExternal(a.href);
          return;
        }
        onClick?.(e);
      }}
    />
  );
});
