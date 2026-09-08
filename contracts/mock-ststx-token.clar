;; mock-ststx-token
;; Test-only SIP-010 stand-in for StackingDAO's stSTX
;; (SP4SZE494VC2YC5JYG7AYFQ44F5Q4PYV7DVMDPBG.ststx-token). Open mint so
;; tests can fund wallets. Never deployed to mainnet.

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant ERR-NOT-AUTHORIZED (err u100))

(define-fungible-token ststx)

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? ststx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-read-only (get-name)
  (ok "Mock Stacked STX"))

(define-read-only (get-symbol)
  (ok "stSTX"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance ststx who)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply ststx)))

(define-read-only (get-token-uri)
  (ok none))

;; Test helper: unrestricted mint.
(define-public (mint (amount uint) (recipient principal))
  (ft-mint? ststx amount recipient))
