import type { HoldEditFeedbackProps } from '../types/editorUi';
import './HoldToEdit.css';

// Keep the centre clear: the authored stitches sit outside a typical thumb pad.
const STITCHES = [[18,1,4,1],[27,4,3,1],[34,10,1,3],[38,18,1,4],[34,27,1,3],[27,34,3,1],[18,38,4,1],[10,34,3,1],[5,27,1,3],[1,18,1,4],[5,10,1,3],[10,4,3,1]];

/** Fill a sparse, authored pixel stitch while the user holds, without moving the art.
 * @param props - Stationary contact point and the hold/activation stages.
 * @returns A discrete 450ms progress cue followed by one quiet filled acknowledgment.
 */
export function HoldEditFeedback({ holding, activated, point }: HoldEditFeedbackProps) {
  return <span className={`hold-edit-progress ${holding ? 'hold-edit-progress--holding' : ''} ${activated ? 'hold-edit-progress--activated' : ''}`} style={point ? { left:point.x, top:point.y } : undefined} aria-hidden="true"><svg width="116" height="116" viewBox="0 0 40 40" shapeRendering="crispEdges" fill="currentColor">
    {STITCHES.map(([x,y,width,height], index) => <rect key={index} className="hold-edit-stitch" x={x} y={y} width={width} height={height} style={{ animationDelay:`${(index + 1) * 36}ms` }} />)}
    {activated && <path d="M16 19h1v1h1v1h1v-1h1v-1h1v-1h1v2h-1v1h-1v1h-1v1h-1v-1h-1v-1h-1Z" opacity=".7" />}
  </svg></span>;
}
