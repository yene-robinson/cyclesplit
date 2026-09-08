;; mock-hostile-rate-source
;; Test-only attacker rate source. Satisfies <rate-source> and reports an
;; absurd ratio designed to overflow downstream arithmetic or mint far more
;; principal than a deposit backs. It records every call, so tests can prove
;; the vault rejected it before asking it for anything.

(impl-trait .rate-source-trait.rate-source-trait)

(define-data-var calls uint u0)

(define-public (get-ratio)
  (begin
    (var-set calls (+ (var-get calls) u1))
    (ok u999999999999)))

(define-read-only (get-calls) (var-get calls))
