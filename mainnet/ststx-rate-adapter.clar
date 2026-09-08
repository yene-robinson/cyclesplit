;; ststx-rate-adapter
;; Mainnet rate source: STX per stSTX, scaled by u1000000 (6 decimals).
;;
;; Mirrors StackingDAO's own data-core-v3 formula:
;;
;;   stx-for-ststx = reserve.get-total-stx
;;                   - ststxbtc-token.get-total-supply
;;                   - ststxbtc-token-v2.get-total-supply
;;   ratio         = stx-for-ststx * 1e6 / ststx-token.get-total-supply
;;
;; The subtraction is essential and easy to miss: stx-reserve-v2 backs BOTH
;; stSTX and stSTXbtc. Dividing the whole reserve by the stSTX supply alone
;; overstates the ratio badly -- as of 2026-09-08 that error reads u1720578
;; against a true u1169702, which would mint ~47% too many principal units
;; per deposit and leave the vault unable to redeem every PT.
;;
;; We compute directly rather than calling data-core because that entry point
;; takes a <reserve-trait> whose get-total-stx returns (response uint uint),
;; while the live stx-reserve-v2 returns a plain uint, so the call no longer
;; type-checks. The older reserve-v1 is drained legacy state (701,055 STX,
;; get-stx-stacking u0) and must not be used.
;;
;; The subtraction underflows and aborts if the reserve ever holds less than
;; the stSTXbtc supply. Failing loudly is the correct behaviour there.

(impl-trait .rate-source-trait.rate-source-trait)

(define-constant ERR-NO-SUPPLY (err u400))
(define-constant RATIO-SCALE u1000000)

(define-public (get-ratio)
  (let (
    (total-stx (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.stx-reserve-v2 get-total-stx))
    (btc-supply (unwrap-panic (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token get-total-supply)))
    (btc-supply-v2 (unwrap-panic (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststxbtc-token-v2 get-total-supply)))
    (supply (unwrap-panic (contract-call? 'SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token get-total-supply)))
    (stx-for-ststx (- total-stx btc-supply btc-supply-v2))
  )
    (asserts! (> supply u0) ERR-NO-SUPPLY)
    (ok (/ (* stx-for-ststx RATIO-SCALE) supply))))
