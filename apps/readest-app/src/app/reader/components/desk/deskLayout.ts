/**
 * deskLayout — the spatial layout engine of the PENECHO pivot.
 * Pure, DOM-free: given the flat transcript, derive clusters and placements.
 *
 * Cluster contract (e2 §1): the cluster of a user block U = the maximal run
 * of professor blocks after U until the next user block. Leading professor
 * blocks (session greeting) form a greeting cluster with a null anchor.
 *
 * Placement contract (e3 §1 + e2 §1.3): a cluster whose anchor carries
 * stored x/y is SPATIAL — the anchor keeps its point and the professor's
 * artifacts stack beside it (wide stage) or below it (narrow stage). A
 * cluster whose anchor lacks placement — and the greeting cluster — is a
 * COLUMN cluster: its blocks take the legacy 720px measure, byte-identical
 * to the pre-pivot column. Mixed sheets interleave the two kinds in
 * document order; layoutSheet reconciles them with a no-overlap clamp.
 */

import type { TranscriptBlock } from '../notebook/workbenchChat';

export interface DeskCluster {
  /** the anchor user block, or null for the session-greeting cluster */
  anchor: TranscriptBlock | null;
  /** professor artifact blocks, document order */
  artifacts: TranscriptBlock[];
}

/** Group the flat transcript into clusters (document order preserved). */
export function buildClusters(blocks: TranscriptBlock[]): DeskCluster[] {
  const clusters: DeskCluster[] = [];
  let pending: DeskCluster | null = null;
  for (const b of blocks) {
    if (b.author === 'user') {
      if (pending) clusters.push(pending);
      pending = { anchor: b, artifacts: [] };
    } else {
      if (!pending) pending = { anchor: null, artifacts: [] };
      pending.artifacts.push(b);
    }
  }
  if (pending) clusters.push(pending);
  return clusters;
}

/** Horizontal geometry of the sheet stage (e3 §1): a wide stage with a
 *  centered legacy column. Placed blocks live free within the margins. */
export const STAGE = {
  /** legacy column width (matches .desk-column) */
  columnWidth: 720,
  /** gutter between an anchor box and its artifact rail */
  clusterGap: 24,
  /** user anchor box width */
  anchorWidth: 380,
  /** professor artifact width in a cluster */
  artifactWidth: 380,
  /** vertical gap between clusters */
  clusterVGap: 32,
  /** side margins of the free stage */
  marginX: 32,
} as const;

export interface ClusterPlacement {
  x: number;
  y: number;
  width: number;
}

export interface ClusterLayout {
  /**
   * 'column' — unplaced anchor or greeting cluster: members stack in the
   *           legacy measure, byte-identical to the pre-pivot column.
   * 'beside' — artifacts stack level with the anchor, to its right.
   * 'below'  — narrow stage: artifacts stack under the anchor.
   */
  mode: 'column' | 'beside' | 'below';
  /** anchor position (null anchor = legacy greeting cluster) */
  anchor: ClusterPlacement | null;
  /** artifact positions in artifact order; y grows downward */
  artifacts: ClusterPlacement[];
  /** estimated cluster height for flow-slot bookkeeping */
  height: number;
}

/** Estimated block heights for layout-before-measure (e2 §2): prose is
 *  short; derivations and diagrams are tall; streaming grows. The char
 *  density assumes the spatial box widths (~48 chars/line at 380px), so
 *  reservations err generous on the wider legacy measure. */
export function estimateHeight(b: TranscriptBlock): number {
  if (b.derivation) return 320 + b.derivation.steps.length * 56;
  if (b.diagram) return 300;
  if (b.plot) return 340;
  if (b.chart) return 300;
  const chars = b.content.length;
  return Math.max(88, Math.ceil(chars / 48) * 24 + 64);
}

/** The legacy column geometry on a stage of the given width. */
const columnPlacement = (stageWidth: number, y: number): ClusterPlacement => {
  const width = Math.min(STAGE.columnWidth, Math.max(0, stageWidth - STAGE.marginX * 2));
  return { x: Math.max(STAGE.marginX, (stageWidth - width) / 2), y, width };
};

/**
 * Lay out one cluster. A SPATIAL cluster's anchor keeps its stored (x,y);
 * artifacts stack to the RIGHT of the anchor when the stage is wide enough
 * (anchor + gap + artifact + margins fit), else BELOW the anchor. A COLUMN
 * cluster (unplaced anchor, or the null-anchor greeting) stacks anchor and
 * artifacts in the centered legacy measure at `flowY` — today's rendering.
 */
export function layoutCluster(
  cluster: DeskCluster,
  stageWidth: number,
  flowY: number,
): ClusterLayout {
  const { anchor, artifacts } = cluster;
  const placed = anchor != null && anchor.x != null && anchor.y != null;
  const anchorPos: ClusterPlacement | null = anchor
    ? placed
      ? { x: anchor.x!, y: anchor.y!, width: anchor.width ?? STAGE.anchorWidth }
      : columnPlacement(stageWidth, flowY)
    : null;

  const mode: ClusterLayout['mode'] = !placed
    ? 'column'
    : anchorPos!.x + STAGE.anchorWidth + STAGE.clusterGap + STAGE.artifactWidth + STAGE.marginX <=
        stageWidth
      ? 'beside'
      : 'below';

  const baseX = anchorPos ? anchorPos.x : columnPlacement(stageWidth, 0).x;
  const baseY = anchorPos ? anchorPos.y : flowY;
  const anchorH = anchor ? estimateHeight(anchor) : 0;

  const artifactLayouts: ClusterPlacement[] = [];
  // Beside mode begins level with the anchor ("he writes beside your ink");
  // column/below modes begin UNDER the anchor — never overlapping it.
  let cursorY = mode === 'beside' ? baseY : baseY + (anchor ? anchorH + STAGE.clusterGap : 0);
  for (const a of artifacts) {
    // Dragged/moved blocks keep their hand-placed point (owner dogfood:
    // "if you could get the responses and move them around").
    if (a.x != null && a.y != null) {
      artifactLayouts.push({ x: a.x, y: a.y, width: a.width ?? STAGE.artifactWidth });
      cursorY += estimateHeight(a) + STAGE.clusterGap;
      continue;
    }
    const slot: ClusterPlacement =
      mode === 'beside'
        ? {
            x: baseX + STAGE.anchorWidth + STAGE.clusterGap,
            y: cursorY,
            width: STAGE.artifactWidth,
          }
        : mode === 'below'
          ? { x: baseX, y: cursorY, width: STAGE.anchorWidth }
          : columnPlacement(stageWidth, cursorY);
    artifactLayouts.push(slot);
    cursorY += estimateHeight(a) + STAGE.clusterGap;
  }

  const height = Math.max(cursorY - baseY, anchorH) + STAGE.clusterVGap;
  return { mode, anchor: anchorPos, artifacts: artifactLayouts, height };
}

/** True when any block carries placement — the sheet goes spatial; a pure
 *  legacy sheet renders in the single column (e3 §2 fallback). */
export function isSpatialSheet(blocks: TranscriptBlock[]): boolean {
  return blocks.some((b) => b.x != null && b.y != null);
}

// ---------------------------------------------------------------------------
// layoutSheet — the whole-sheet pass: clusters in document order, the
// no-overlap clamp, the streaming slot, and the reserved stage extent.
// ---------------------------------------------------------------------------

export interface SheetLayout {
  /** Every block's laid-out slot, keyed by block id. */
  placements: Map<string, ClusterPlacement>;
  /** Where the in-flight professor reply mounts: the next artifact slot of
   *  the LAST cluster (the active exchange). null on an empty sheet. */
  streamSlot: ClusterPlacement | null;
  /** Reserved stage height (px) — the sum of cluster extents. */
  extent: number;
}

/** Sentinel artifact used to probe the next free slot of the open cluster;
 *  only the slot's coordinates are read, never the block. */
const STREAM_SENTINEL: TranscriptBlock = {
  id: '__desk_stream__',
  author: 'professor',
  content: '',
  at: '',
};

/**
 * Reconcile the whole sheet (e3 §2 mixed-transcript rule). OWNER RULING
 * (2026-09-16 dogfood): a hand-placed point is respected VERBATIM — no
 * downward clamp. The sheet is the user's to arrange; overlap is theirs
 * to fix by dragging, not ours to prevent by moving their ink.
 */
export function layoutSheet(blocks: TranscriptBlock[], stageWidth: number): SheetLayout {
  const clusters = buildClusters(blocks);
  const placements = new Map<string, ClusterPlacement>();
  let cursor = 0;
  let streamSlot: ClusterPlacement | null = null;

  clusters.forEach((c, ci) => {
    const flowY = cursor;
    const layout = layoutCluster(c, stageWidth, flowY);
    // Owner ruling: no clamp. Stored points are verbatim; shift stays 0.
    const shift = 0;
    const put = (id: string, p: ClusterPlacement) =>
      placements.set(id, { x: p.x, y: p.y + shift, width: p.width });
    if (layout.anchor && c.anchor) put(c.anchor.id, layout.anchor);
    c.artifacts.forEach((a, i) => {
      const p = layout.artifacts[i];
      if (p) put(a.id, p);
    });
    const baseY = (layout.anchor ? layout.anchor.y : flowY) + shift;
    cursor = Math.max(cursor, baseY + layout.height);

    if (ci === clusters.length - 1) {
      // The streaming nib mounts at the open cluster's next artifact slot
      // (beside/below the anchor per the same frozen geometry); on commit
      // the block adopts exactly this slot.
      const probe = layoutCluster(
        { anchor: c.anchor, artifacts: [...c.artifacts, STREAM_SENTINEL] },
        stageWidth,
        flowY,
      );
      const slot = probe.artifacts[probe.artifacts.length - 1];
      streamSlot = slot ? { x: slot.x, y: slot.y + shift, width: slot.width } : null;
    }
  });

  return { placements, streamSlot, extent: cursor };
}
