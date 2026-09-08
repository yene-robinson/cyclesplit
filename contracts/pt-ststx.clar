;; pt-ststx -- Principal Token
;; SIP-010 token denominated in micro-STX of principal redeemable at
;; maturity. 1 PT redeems for exactly 1 uSTX worth of stSTX at the
;; maturity exchange ratio. Mint/burn are restricted to the vault.

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant ERR-NOT-AUTHORIZED (err u200))
(define-constant ERR-VAULT-ALREADY-SET (err u201))
(define-constant CONTRACT-OWNER tx-sender)

(define-fungible-token pt-ststx)

(define-data-var vault (optional principal) none)

;; One-time wiring: tokens deploy before the vault, so the deployer binds
;; the vault principal after deployment. Immutable once set.
(define-public (set-vault (new-vault principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (is-none (var-get vault)) ERR-VAULT-ALREADY-SET)
    (ok (var-set vault (some new-vault)))))

(define-read-only (get-vault)
  (var-get vault))

(define-private (is-vault)
  (is-eq (some contract-caller) (var-get vault)))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (ft-mint? pt-ststx amount recipient)))

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (ft-burn? pt-ststx amount owner)))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (try! (ft-transfer? pt-ststx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-read-only (get-name)
  (ok "CycleSplit Principal stSTX"))

(define-read-only (get-symbol)
  (ok "PT-stSTX"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance pt-ststx who)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply pt-ststx)))

(define-read-only (get-token-uri)
  (ok none))
