;; yt-ststx -- Yield Token
;; SIP-010 token entitling the holder to stacking yield accrued on the
;; matching principal from their entry point until maturity. Yield is
;; tracked with a global monotone index (pushed by the vault) and per-user
;; checkpoints settled on every mint, burn, and transfer, so YT stays
;; fungible while yield attribution stays fair across entry times.
;;
;; accrued(user) += balance * (index - checkpoint(user)) / INDEX-SCALE
;; where index units are micro-stSTX per YT unit, scaled by 1e12.

(impl-trait 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)

(define-constant ERR-NOT-AUTHORIZED (err u210))
(define-constant ERR-VAULT-ALREADY-SET (err u211))
(define-constant ERR-INDEX-DECREASE (err u212))
(define-constant CONTRACT-OWNER tx-sender)

(define-constant INDEX-SCALE u1000000000000)

(define-fungible-token yt-ststx)

(define-data-var vault (optional principal) none)
(define-data-var yield-index uint u0)

(define-map checkpoints principal uint)
(define-map accrued principal uint)

(define-public (set-vault (new-vault principal))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (is-none (var-get vault)) ERR-VAULT-ALREADY-SET)
    (ok (var-set vault (some new-vault)))))

(define-read-only (get-vault)
  (var-get vault))

(define-private (is-vault)
  (is-eq (some contract-caller) (var-get vault)))

;; Settle a user's accrual up to the current index and move their
;; checkpoint forward. With a zero balance this only refreshes the
;; checkpoint, so the map default of u0 is never exploitable.
(define-private (settle (user principal))
  (let ((bal (ft-get-balance yt-ststx user))
        (idx (var-get yield-index))
        (chk (default-to u0 (map-get? checkpoints user))))
    (begin
      (if (and (> bal u0) (> idx chk))
        (map-set accrued user
          (+ (default-to u0 (map-get? accrued user))
             (/ (* bal (- idx chk)) INDEX-SCALE)))
        true)
      (map-set checkpoints user idx)
      true)))

;; Vault pushes a fresh index whenever the stSTX ratio advances.
(define-public (update-index (new-index uint))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (asserts! (>= new-index (var-get yield-index)) ERR-INDEX-DECREASE)
    (ok (var-set yield-index new-index))))

(define-public (mint (amount uint) (recipient principal))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (settle recipient)
    (ft-mint? yt-ststx amount recipient)))

(define-public (burn (amount uint) (owner principal))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (settle owner)
    (ft-burn? yt-ststx amount owner)))

;; Vault-only: settle and sweep a user's claimable yield.
(define-public (take-accrued (user principal))
  (begin
    (asserts! (is-vault) ERR-NOT-AUTHORIZED)
    (settle user)
    (let ((amount (default-to u0 (map-get? accrued user))))
      (map-delete accrued user)
      (ok amount))))

(define-public (transfer (amount uint) (sender principal) (recipient principal) (memo (optional (buff 34))))
  (begin
    (asserts! (is-eq tx-sender sender) ERR-NOT-AUTHORIZED)
    (settle sender)
    (settle recipient)
    (try! (ft-transfer? yt-ststx amount sender recipient))
    (match memo to-print (print to-print) 0x)
    (ok true)))

(define-read-only (get-yield-index)
  (var-get yield-index))

(define-read-only (get-checkpoint (user principal))
  (default-to u0 (map-get? checkpoints user)))

;; Claimable yield if the user settled right now (against the last pushed
;; index; call vault.sync first for a live figure).
(define-read-only (get-accrued-preview (user principal))
  (let ((bal (ft-get-balance yt-ststx user))
        (idx (var-get yield-index))
        (chk (default-to u0 (map-get? checkpoints user))))
    (+ (default-to u0 (map-get? accrued user))
       (if (and (> bal u0) (> idx chk))
         (/ (* bal (- idx chk)) INDEX-SCALE)
         u0))))

(define-read-only (get-name)
  (ok "CycleSplit Yield stSTX"))

(define-read-only (get-symbol)
  (ok "YT-stSTX"))

(define-read-only (get-decimals)
  (ok u6))

(define-read-only (get-balance (who principal))
  (ok (ft-get-balance yt-ststx who)))

(define-read-only (get-total-supply)
  (ok (ft-get-supply yt-ststx)))

(define-read-only (get-token-uri)
  (ok none))
