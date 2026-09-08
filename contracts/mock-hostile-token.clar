;; mock-hostile-token
;; Test-only attacker contract modelled on the June 2025 ALEX Protocol exploit,
;; where a fake token carrying a malicious transfer function was passed into a
;; protocol that accepted arbitrary tokens, and used to drain pooled funds.
;;
;; It is a fully valid SIP-010, so it satisfies <sip-010-token> and can be handed
;; to any vault entry point. Its transfer records every invocation, attempts to
;; re-enter the vault, and can be told to lie about having moved funds.
;;
;; The point of the tests that use it: the vault must reject it before any of
;; this code runs, so transfer-calls stays at zero.

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-fungible-token hostile)

(define-data-var transfer-calls uint u0)
(define-data-var reentry-attempts uint u0)
(define-data-var reentry-blocked bool false)
(define-data-var lie bool false)

;; When set, transfer reports success without moving anything.
(define-public (set-lie (value bool))
  (ok (var-set lie value)))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (var-set transfer-calls (+ (var-get transfer-calls) u1))
    (var-set reentry-attempts (+ (var-get reentry-attempts) u1))
    ;; Re-enter the vault in the middle of its own transfer.
    (match (contract-call? .cyclesplit-vault sync .mock-rate-source)
      ok-value true
      err-value (begin (var-set reentry-blocked true) true))
    (if (var-get lie)
      (ok true)
      (begin
        (try! (ft-transfer? hostile amount sender recipient))
        (ok true)))))

(define-read-only (get-transfer-calls) (var-get transfer-calls))
(define-read-only (get-reentry-attempts) (var-get reentry-attempts))
(define-read-only (get-reentry-blocked) (var-get reentry-blocked))

(define-public (mint (amount uint) (recipient principal))
  (ft-mint? hostile amount recipient))

(define-read-only (get-name) (ok "Hostile Token"))
(define-read-only (get-symbol) (ok "EVIL"))
(define-read-only (get-decimals) (ok u6))
(define-read-only (get-balance (who principal)) (ok (ft-get-balance hostile who)))
(define-read-only (get-total-supply) (ok (ft-get-supply hostile)))
(define-read-only (get-token-uri) (ok none))
