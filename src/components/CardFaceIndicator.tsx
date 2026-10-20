/** Identify the visible side without framing the study content.
 * @param props.face - The side currently visible to the learner.
 * @returns A small, noninteractive pair of outlined card faces and a caption.
 */
export function CardFaceIndicator({ face }: { face: 'front' | 'back' }) {
  return <div className="card-face-indicator" role="img" aria-label={face === 'front' ? 'Question, side 1 of 2' : 'Answer, side 2 of 2'}>
    <svg width="44" height="26" viewBox="0 0 44 26" fill="none" aria-hidden="true">
      {(['front', 'back'] as const).map((side, index) => <g key={side} opacity={face === side ? 1 : .3} transform={`translate(${index * 24} 0)`}>
        <rect x=".75" y="1.75" width="18.5" height="22.5" rx="3" stroke="currentColor" strokeOpacity={face === side ? .65 : .5} fill="currentColor" fillOpacity={face === side ? .08 : 0} />
        <text x="10" y="17" textAnchor="middle" fill="currentColor" fontSize="13" fontFamily="Baskerville, Georgia, serif" fontStyle="italic">{index + 1}</text>
      </g>)}
    </svg>
    <span aria-hidden="true">{face === 'front' ? 'Question' : 'Answer'}</span>
  </div>;
}
