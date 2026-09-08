;; mock-rate-source-2
;; Test-only rate source with a settable ratio. On mainnet the vault is
;; configured with ststx-rate-adapter, which reads the canonical
;; StackingDAO ratio instead.

(impl-trait .rate-source-trait.rate-source-trait)

(define-constant ERR-NOT-AUTHORIZED (err u100))
(define-constant CONTRACT-OWNER tx-sender)

;; 1.0 STX per stSTX by default
(define-data-var ratio uint u1000000)

(define-public (set-ratio (new-ratio uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (ok (var-set ratio new-ratio))))

(define-public (get-ratio)
  (ok (var-get ratio)))
