/** SurePesa for Business wordmark with a solid monogram. */
export function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className={`brand${inverse ? ' inverse' : ''}`}>
      <div className="brand-mark" aria-hidden>S</div>
      <span>
        SurePesa <small>for Business</small>
      </span>
    </div>
  );
}
