;; rate-source-trait
;; Minimal interface for a contract that reports the stSTX -> STX exchange
;; ratio, scaled by u1000000 (6 decimals). e.g. u1100000 = 1.10 STX per stSTX.
;;
;; A liquid stacking token is designed to accrue, so the ratio should rise
;; over time. The vault does not depend on that: it tracks the highest ratio
;; it has observed and drives the yield index from that, so a transient dip
;; reported by a source can never rewind already-accrued yield.
;;
;; The residual risk that guard leaves is worth stating plainly. If the ratio
;; genuinely falls and stays down through maturity, yield already streamed to
;; YT holders cannot be clawed back, so PT settles against the high-water
;; ratio and its holders absorb the difference. PT is therefore fixed with
;; respect to the yield curve, not risk-free with respect to the underlying.

(define-trait rate-source-trait
  (
    (get-ratio () (response uint uint))
  )
)
