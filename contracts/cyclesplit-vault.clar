;; cyclesplit-vault
;; Fixed-maturity yield splitter for stSTX (StackingDAO liquid stacking).
;;
;; deposit:  a uStSTX at ratio r  ->  mints (a * r / 1e6) PT and YT units,
;;           each unit = 1 uSTX of principal at maturity.
;; yield:    as the stSTX/STX ratio rises, the stSTX backing 1 uSTX of
;;           principal shrinks; the freed stSTX is streamed to YT holders
;;           via a monotone index (see yt-ststx).
;; maturity: at the maturity burn height anyone settles the series; PT
;;           then redeems (amount * 1e6 / maturity-ratio) uStSTX; YT stops
;;           accruing and holders claim what remains.
;;
;; No oracle: the ratio is read onchain (mainnet: ststx-rate-adapter ->
;; StackingDAO data-core-v2). No margin, no liquidations. All divisions
;; round down, so rounding dust accumulates to the vault, never against it.

(use-trait sip-010-token 'SP3FBR2AGK5H9QBDH3EEN6DF8EK8JY7RX8QJ5SVTE.sip-010-trait-ft-standard.sip-010-trait)
(use-trait rate-source .rate-source-trait.rate-source-trait)

(define-constant ERR-NOT-AUTHORIZED (err u300))
(define-constant ERR-ALREADY-INITIALIZED (err u301))
(define-constant ERR-NOT-INITIALIZED (err u302))
(define-constant ERR-INVALID-RATE-SOURCE (err u303))
(define-constant ERR-INVALID-TOKEN (err u304))
(define-constant ERR-ZERO-AMOUNT (err u305))
(define-constant ERR-MATURED (err u306))
(define-constant ERR-NOT-MATURED (err u307))
(define-constant ERR-ALREADY-SETTLED (err u308))
(define-constant ERR-NOT-SETTLED (err u309))
(define-constant ERR-NOTHING-TO-CLAIM (err u310))
(define-constant ERR-INVALID-MATURITY (err u311))
(define-constant ERR-INVALID-RATIO (err u312))

(define-constant CONTRACT-OWNER tx-sender)

;; ratio is STX-per-stSTX scaled by 1e6; index math scaled by 1e12
(define-constant RATIO-SCALE u1000000)
(define-constant INDEX-SCALE u1000000000000)

(define-data-var initialized bool false)
(define-data-var cfg-ststx (optional principal) none)
(define-data-var cfg-rate-source (optional principal) none)
(define-data-var cfg-maturity uint u0)
(define-data-var genesis-ratio uint u0)
;; highest ratio observed; keeps the yield index monotone even if the
;; source ever reports a transient dip
(define-data-var max-ratio uint u0)
(define-data-var settled bool false)
(define-data-var maturity-ratio uint u0)

;; uStSTX backing one uSTX of principal, scaled by INDEX-SCALE
(define-private (backing-per-unit (r uint))
  (/ (* INDEX-SCALE RATIO-SCALE) r))

(define-private (check-token (token <sip-010-token>))
  (ok (asserts! (is-eq (some (contract-of token)) (var-get cfg-ststx)) ERR-INVALID-TOKEN)))

(define-private (check-rate-source (source <rate-source>))
  (ok (asserts! (is-eq (some (contract-of source)) (var-get cfg-rate-source)) ERR-INVALID-RATE-SOURCE)))

;; Advance max-ratio and push the new yield index when the ratio grows.
(define-private (do-sync (r uint))
  (if (> r (var-get max-ratio))
    (begin
      (var-set max-ratio r)
      (try! (contract-call? .yt-ststx update-index
        (- (backing-per-unit (var-get genesis-ratio)) (backing-per-unit r))))
      (ok true))
    (ok true)))

(define-private (read-and-sync (source <rate-source>))
  (let ((r (try! (contract-call? source get-ratio))))
    (asserts! (> r u0) ERR-INVALID-RATIO)
    (try! (do-sync r))
    (ok (var-get max-ratio))))

;; One-time setup by the deployer: binds the stSTX token and rate source
;; principals and fixes the maturity burn height.
(define-public (initialize (token <sip-010-token>) (source <rate-source>) (maturity uint))
  (begin
    (asserts! (is-eq tx-sender CONTRACT-OWNER) ERR-NOT-AUTHORIZED)
    (asserts! (not (var-get initialized)) ERR-ALREADY-INITIALIZED)
    (asserts! (> maturity burn-block-height) ERR-INVALID-MATURITY)
    (let ((r (try! (contract-call? source get-ratio))))
      (asserts! (> r u0) ERR-INVALID-RATIO)
      (var-set cfg-ststx (some (contract-of token)))
      (var-set cfg-rate-source (some (contract-of source)))
      (var-set cfg-maturity maturity)
      (var-set genesis-ratio r)
      (var-set max-ratio r)
      (var-set initialized true)
      (print { event: "initialize", maturity: maturity, genesis-ratio: r })
      (ok true))))

;; Permissionless: refresh the yield index from the rate source.
(define-public (sync (source <rate-source>))
  (begin
    (asserts! (var-get initialized) ERR-NOT-INITIALIZED)
    (asserts! (not (var-get settled)) ERR-ALREADY-SETTLED)
    (try! (check-rate-source source))
    (read-and-sync source)))

;; Split stSTX into equal PT and YT, denominated in uSTX of principal.
(define-public (deposit (amount uint) (token <sip-010-token>) (source <rate-source>))
  (begin
    (asserts! (var-get initialized) ERR-NOT-INITIALIZED)
    (asserts! (< burn-block-height (var-get cfg-maturity)) ERR-MATURED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (try! (check-token token))
    (try! (check-rate-source source))
    (let ((r (try! (read-and-sync source)))
          (units (/ (* amount r) RATIO-SCALE)))
      (asserts! (> units u0) ERR-ZERO-AMOUNT)
      (try! (contract-call? token transfer amount tx-sender (as-contract tx-sender) none))
      (try! (contract-call? .pt-ststx mint units tx-sender))
      (try! (contract-call? .yt-ststx mint units tx-sender))
      (print { event: "deposit", user: tx-sender, ststx-in: amount, units: units, ratio: r })
      (ok units))))

;; Pre-maturity exit: burn equal PT + YT to withdraw the underlying
;; principal at the current ratio. Yield accrued so far stays claimable.
(define-public (redeem-pair (amount uint) (token <sip-010-token>) (source <rate-source>))
  (begin
    (asserts! (var-get initialized) ERR-NOT-INITIALIZED)
    (asserts! (not (var-get settled)) ERR-ALREADY-SETTLED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (try! (check-token token))
    (try! (check-rate-source source))
    (let ((r (try! (read-and-sync source)))
          (user tx-sender)
          (out (/ (* amount RATIO-SCALE) r)))
      (asserts! (> out u0) ERR-ZERO-AMOUNT)
      (try! (contract-call? .pt-ststx burn amount user))
      (try! (contract-call? .yt-ststx burn amount user))
      (try! (as-contract (contract-call? token transfer out tx-sender user none)))
      (print { event: "redeem-pair", user: user, units: amount, ststx-out: out, ratio: r })
      (ok out))))

;; Permissionless after the maturity burn height: freeze the series at the
;; final ratio. PT redemption and final YT claims open from here.
(define-public (settle-maturity (source <rate-source>))
  (begin
    (asserts! (var-get initialized) ERR-NOT-INITIALIZED)
    (asserts! (not (var-get settled)) ERR-ALREADY-SETTLED)
    (asserts! (>= burn-block-height (var-get cfg-maturity)) ERR-NOT-MATURED)
    (try! (check-rate-source source))
    (let ((r (try! (read-and-sync source))))
      (var-set maturity-ratio r)
      (var-set settled true)
      (print { event: "settle-maturity", maturity-ratio: r })
      (ok r))))

;; Post-settlement: burn PT for its fixed principal, paid in stSTX at the
;; maturity ratio.
(define-public (redeem-pt (amount uint) (token <sip-010-token>))
  (begin
    (asserts! (var-get settled) ERR-NOT-SETTLED)
    (asserts! (> amount u0) ERR-ZERO-AMOUNT)
    (try! (check-token token))
    (let ((user tx-sender)
          (out (/ (* amount RATIO-SCALE) (var-get maturity-ratio))))
      (asserts! (> out u0) ERR-ZERO-AMOUNT)
      (try! (contract-call? .pt-ststx burn amount user))
      (try! (as-contract (contract-call? token transfer out tx-sender user none)))
      (print { event: "redeem-pt", user: user, pt-burned: amount, ststx-out: out })
      (ok out))))

;; Claim accrued yield in stSTX. Syncs first while the series is live so
;; the payout reflects the latest ratio.
(define-public (claim-yield (token <sip-010-token>) (source <rate-source>))
  (begin
    (asserts! (var-get initialized) ERR-NOT-INITIALIZED)
    (try! (check-token token))
    (try! (check-rate-source source))
    (if (var-get settled)
      true
      (begin (try! (read-and-sync source)) true))
    (let ((user tx-sender)
          (amount (try! (contract-call? .yt-ststx take-accrued tx-sender))))
      (asserts! (> amount u0) ERR-NOTHING-TO-CLAIM)
      (try! (as-contract (contract-call? token transfer amount tx-sender user none)))
      (print { event: "claim-yield", user: user, ststx-out: amount })
      (ok amount))))

(define-read-only (get-info)
  {
    initialized: (var-get initialized),
    ststx-token: (var-get cfg-ststx),
    rate-source: (var-get cfg-rate-source),
    maturity-height: (var-get cfg-maturity),
    genesis-ratio: (var-get genesis-ratio),
    current-ratio: (var-get max-ratio),
    settled: (var-get settled),
    maturity-ratio: (var-get maturity-ratio),
    burn-height: burn-block-height
  })
