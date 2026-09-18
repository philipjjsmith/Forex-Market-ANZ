import { PublicLayout } from "@/components/public-layout";
import { BACKTEST, COSTS, MYFXBOOK } from "@/lib/public-facts";

/**
 * The record. This page is the product's only real differentiator, so it gets a page
 * rather than a tab.
 *
 * NOTE ON WHAT IS AND IS NOT HERE. Every signal endpoint on the API requires
 * authentication, so this page cannot yet stream the live trade log — that needs a
 * public read-only endpoint, which publishes data outward and is therefore Philip's
 * decision, not a thing to add quietly. Until then the page carries the figures that
 * are already published and independently checkable, each one sourced in
 * lib/public-facts.ts.
 *
 * The historical live aggregate is deliberately NOT presented as evidence. Its sign
 * depends on which de-duplication rule is applied — the same underlying rows produce
 * anywhere from +177 to -1,190 pips — so quoting any single figure from it would be
 * choosing the number that flatters. That is exactly the researcher degree of freedom
 * the pre-registration exists to remove.
 */

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr className="border-b border-border last:border-b-0">
      <th scope="row" className="py-3 pr-6 text-left text-sm font-normal text-muted-foreground">
        {label}
      </th>
      <td className="tnum py-3 pr-6 text-sm text-foreground">{value}</td>
      <td className="py-3 text-sm text-muted-foreground">{note ?? ""}</td>
    </tr>
  );
}

export default function Evidence() {
  const m = MYFXBOOK.snapshot;

  return (
    <PublicLayout>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <p className="type-label mb-5 text-primary">The record</p>
        <h1 className="type-display measure text-foreground">
          The result, including the part that does not flatter it.
        </h1>
        <p className="measure mt-5 text-lg leading-relaxed text-muted-foreground">
          Everything below is either reproducible from the pre-registered test or held by a
          third party who has no reason to make it look good.
        </p>

        {/* ── Pre-registered result ────────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="type-h2 text-foreground">The pre-registered test</h2>
          <p className="measure mt-3 text-muted-foreground">
            Replayed from price data under rules fixed in advance, across{" "}
            {BACKTEST.trades.toLocaleString()} trades from August 2022 to August 2026.
          </p>
          <div className="mt-6 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem]">
              <tbody>
                <Row
                  label="Expectancy per trade"
                  value={`${BACKTEST.expectancyR.toFixed(4)} R`}
                  note="Negative. This is the headline result."
                />
                <Row label="Trades" value={BACKTEST.trades.toLocaleString()} />
                <Row
                  label="95% confidence interval"
                  value={`${BACKTEST.ci95[0]} to +${BACKTEST.ci95[1]}`}
                  note="Includes zero; the upper bound is below what would be tradeable"
                />
                <Row
                  label="Deflated Sharpe ratio"
                  value={BACKTEST.dsr.toFixed(4)}
                  note="Adjusted for the number of variants tried"
                />
                <Row
                  label="Confidence score vs outcome"
                  value={BACKTEST.confidenceCorrelation.toFixed(4)}
                  note="The score does not rank trades"
                />
                <Row
                  label="Commission, measured"
                  value={`${COSTS.commissionPipsRoundTurn} pips / round turn`}
                  note={`Against a ${COSTS.breakEvenSpreadPips}-pip break-even spread`}
                />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">Source: {BACKTEST.source}.</p>
        </section>

        {/* ── Third-party verification ─────────────────────────────────── */}
        <section className="mt-14">
          <h2 className="type-h2 text-foreground">Independently tracked</h2>
          <p className="measure mt-3 text-muted-foreground">
            The demo account is read directly from the broker by Myfxbook. These numbers are
            not ours to edit.
          </p>
          <div className="mt-6 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[34rem]">
              <tbody>
                <Row label="Account" value={MYFXBOOK.name} note={MYFXBOOK.broker} />
                <Row label="Gain" value={`${m.gainPct}%`} />
                <Row
                  label="Balance"
                  value={`$${m.balanceUsd.toLocaleString()}`}
                  note={`Deposited $${m.depositsUsd.toLocaleString()}`}
                />
                <Row label="Profit" value={`-$${Math.abs(m.profitUsd).toLocaleString()}`} />
                <Row label="Maximum drawdown" value={`${m.drawdownPct}%`} />
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Snapshot taken {m.takenOn}.{" "}
            <a
              href={MYFXBOOK.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-4"
            >
              View the live record on Myfxbook
            </a>
            .
          </p>
        </section>

        {/* ── What is deliberately absent ──────────────────────────────── */}
        <section className="mt-14 rounded-lg border-l-2 border-primary bg-primary/[0.06] p-6">
          <h2 className="type-h3 text-foreground">What is not on this page, and why</h2>
          <div className="measure mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">The historical live aggregate.</span>{" "}
              For most of its life the engine re-emitted the same idea on every cron cycle, so
              the raw log is roughly 90% near-duplicates. Depending on which de-duplication
              rule is applied, the same rows total anywhere from +177 to −1,190 pips. Any
              single figure drawn from it would be a choice about which answer to prefer, so
              none is quoted.
            </p>
            <p>
              <span className="font-medium text-foreground">A live trade feed.</span> Every
              signal endpoint currently requires authentication. Publishing one openly is a
              deliberate decision about releasing data, not a detail to slip in, so the
              streaming record is not here yet.
            </p>
          </div>
        </section>

        <p className="measure mt-12 border-t border-border pt-8 text-sm leading-relaxed text-muted-foreground">
          <span className="font-medium text-foreground">Hypothetical and simulated results.</span>{" "}
          No real money has ever been traded by this system. Simulated results do not
          represent actual trading, have inherent limitations, and are prepared with the
          benefit of hindsight. Past or simulated performance is not indicative of future
          results.
        </p>
      </div>
    </PublicLayout>
  );
}
