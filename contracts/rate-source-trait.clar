;; rate-source-trait
;; Minimal interface for a contract that reports the stSTX -> STX exchange
;; ratio, scaled by u1000000 (6 decimals). e.g. u1100000 = 1.10 STX per stSTX.
;; The ratio is expected to be monotonically non-decreasing (stSTX
;; auto-compounds stacking rewards and has no slashing).

(define-trait rate-source-trait
  (
    (get-ratio () (response uint uint))
  )
)
