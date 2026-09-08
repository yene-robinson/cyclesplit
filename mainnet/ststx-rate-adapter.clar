;; ststx-rate-adapter
;; Mainnet rate source: STX per stSTX, scaled by u1000000 (6 decimals).
;;
;; The ratio is computed directly from StackingDAO's live reserve and the
;; stSTX supply rather than routed through data-core get-stx-per-ststx.
;; Two reasons, both verified against mainnet on 2026-09-05:
;;
;;   1. reserve-v1 is drained legacy state -- 701,055 STX, get-stx-stacking
;;      u0, entire balance earmarked for withdrawals. Reading it yields a
;;      ratio of ~u14851 (0.0148) instead of ~u1757195 (1.757).
;;   2. data-core-v2/v3 get-stx-per-ststx takes a <reserve-trait> whose
;;      get-total-stx returns (response uint uint). The live stx-reserve-v2
;;      returns a plain uint, so that call no longer type-checks.
;;
;; Live figures at time of writing: 82,948,022.8 STX backing
;; 47,204,768.6 stSTX => ratio u1757195.

(impl-trait .rate-source-trait.rate-source-trait)

(define-constant ERR-NO-SUPPLY (err u400))
(define-constant RATIO-SCALE u1000000)

(define-public (get-ratio)
  (let (
    (total-stx (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stx-reserve-v2 get-total-stx))
    (supply (unwrap-panic (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token get-total-supply)))
  )
    (asserts! (> supply u0) ERR-NO-SUPPLY)
    (ok (/ (* total-stx RATIO-SCALE) supply))))
