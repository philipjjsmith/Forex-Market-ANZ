import { Link } from "wouter";
import { PublicLayout } from "@/components/public-layout";
import { BACKTEST, COSTS, MYFXBOOK, TRADING, TELEGRAM_INVITE } from "@/lib/public-facts";

/**
 * The front door, which did not exist.
 *
 * `/` used to be the auth-walled Dashboard, so the entire public surface of this
 * product was a login form. Nothing explained what it was.
 *
 * The positioning is deliberate and it is the opposite of the category's. The
 * pre-registered expectancy is negative, so any "signals that make you money" page
 * would be false — the same class of claim as the bot's "$8K–$12K per month", which
 * was a projection published as history. What this system has that a field full of
 * fabricated 90% win rates does not is an auditable measurement apparatus that
 * publishes its losses. So the page leads with the losing number.
 *
 * Every figure here comes from lib/public-facts.ts, where each one carries its source.
 */

function Stat({
  label,
  value,
  tone = "neutral",
  note,
}: {
  label: string;
  value: string;
  tone?: "neutral" | "down";
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="type-label text-muted-foreground">{label}</span>
      <span
        className={`tnum text-2xl tracking-[-0.02em] ${
          tone === "down" ? "text-market-red" : "text-foreground"
        }`}
      >
        {value}
      </span>
      {note ? <span className="text-xs text-muted-foreground">{note}</span> : null}
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {/* Numbered because this genuinely is a sequence: a setup cannot be scored
          before it is found, and cannot be sent before it is scored. */}
      <span className="tnum type-label text-primary">{n}</span>
      <h3 className="type-h3 text-foreground">{title}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">{children}</p>
    </div>
  );
}

export default function Landing() {
  const m = MYFXBOOK.snapshot;

  return (
    <PublicLayout>
      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 pb-16 pt-20">
        <p className="type-label mb-5 text-primary">Demo · simulated · every outcome published</p>
        <h1 className="type-hero measure text-foreground">
          Intraday forex setups, published with the losses attached.
        </h1>
        <p className="measure mt-6 text-lg leading-relaxed text-muted-foreground">
          ArgosFX runs one pre-registered method on {TRADING.pairs.length} major pairs and
          publishes every signal it produces — the ones that worked and the ones that did
          not. The record below is the real one, and it is currently negative.
        </p>

        <div className="mt-10 flex flex-wrap gap-3">
          {TELEGRAM_INVITE ? (
            <a
              href={TELEGRAM_INVITE}
              className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            >
              Join the free channel
            </a>
          ) : null}
          <Link
            href="/evidence"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            See the record
          </Link>
          <Link
            href="/method"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            How it decides
          </Link>
        </div>
      </section>

      {/* ── The number, stated plainly ─────────────────────────────────── */}
      <section className="border-y border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Expectancy per trade"
              value={`${BACKTEST.expectancyR.toFixed(4)} R`}
              tone="down"
              note="Pre-registered, not fitted after the fact"
            />
            <Stat label="Trades replayed" value={BACKTEST.trades.toLocaleString()} />
            <Stat
              label="95% confidence interval"
              value={`${BACKTEST.ci95[0]} to +${BACKTEST.ci95[1]}`}
              note="Wide enough to include zero"
            />
            <Stat
              label="Score vs outcome"
              value={BACKTEST.confidenceCorrelation.toFixed(4)}
              note="The confidence score does not rank trades"
            />
          </div>

          {/*
            These are hypothetical and simulated results, so CFTC Reg 4.41(b)(1)
            requires the prescribed cautionary statement to accompany them, and (b)(2)
            requires it prominently disclosed in a written presentation. It sits with
            the figures rather than only in the footer for that reason.
          */}
          <p className="measure mt-8 text-sm leading-relaxed text-muted-foreground">
            <span className="font-medium text-foreground">Hypothetical and simulated results.</span>{" "}
            No real money has ever been traded by this system. Simulated results do not
            represent actual trading, have inherent limitations, and are prepared with the
            benefit of hindsight. Past or simulated performance is not indicative of future
            results.
          </p>
        </div>
      </section>

      {/* ── How it decides ─────────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="type-h2 text-foreground">How it decides</h2>
        <p className="measure mt-3 text-muted-foreground">
          One method, written down before it ran, applied the same way every time.
        </p>

        <div className="mt-10 grid gap-10 sm:grid-cols-3">
          <Step n="01" title="Only inside the windows">
            Generation runs during {TRADING.killZones.join(" and ")} UTC and at no other
            time. Outside those hours the system does nothing, by design.
          </Step>
          <Step n="02" title="Scored, then gated">
            Each setup is scored against a fixed confluence model. A correlation guard
            measures the candidate against everything already open and withholds anything
            that would place the same bet twice.
          </Step>
          <Step n="03" title="Resolved against price, not opinion">
            Every signal carries a stop and a target and expires after{" "}
            {TRADING.expiryHours} hours. Outcomes are replayed from 5-minute price data and
            reconciled against the broker's own records.
          </Step>
        </div>

        <div className="mt-10 flex flex-wrap gap-x-8 gap-y-2 border-t border-border pt-6">
          <span className="type-label text-muted-foreground">Pairs traded</span>
          {TRADING.pairs.map((p) => (
            <span key={p} className="tnum text-sm text-foreground">
              {p}
            </span>
          ))}
        </div>
      </section>

      {/* ── Independent verification ───────────────────────────────────── */}
      <section className="border-t border-border bg-card/40">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <h2 className="type-h2 text-foreground">Verified by someone else</h2>
          <p className="measure mt-3 text-muted-foreground">
            The demo account is tracked by Myfxbook, which reads the broker directly. Those
            numbers are not ours to edit — that is the reason for citing them.
          </p>

          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Gain" value={`${m.gainPct}%`} tone="down" />
            <Stat label="Balance" value={`$${m.balanceUsd.toLocaleString()}`} note={`from $${m.depositsUsd.toLocaleString()} deposited`} />
            <Stat label="Profit" value={`-$${Math.abs(m.profitUsd).toLocaleString()}`} tone="down" />
            <Stat label="Max drawdown" value={`${m.drawdownPct}%`} />
          </div>

          <p className="mt-6 text-xs text-muted-foreground">
            Snapshot taken {m.takenOn}. {MYFXBOOK.broker}.{" "}
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
        </div>
      </section>

      {/* ── What this is not ───────────────────────────────────────────── */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <h2 className="type-h2 text-foreground">What this is not</h2>
        <div className="measure mt-6 space-y-4 text-muted-foreground">
          <p>
            It is not a profitable system. The measured edge is negative, and measured
            trading costs of {COSTS.commissionPipsRoundTurn} pips per round turn are roughly
            three times the {COSTS.breakEvenSpreadPips}-pip spread the strategy would need to
            break even.
          </p>
          <p>
            It is not a managed account, a signal subscription, or an invitation to trade
            anyone's money. Nothing here is tailored to you, and none of it is investment
            advice.
          </p>
          <p>
            It is a research instrument that reports on itself honestly — including when the
            answer is that the idea does not work.
          </p>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/method"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Read the method
          </Link>
          <Link
            href="/evidence"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-medium text-foreground transition-colors hover:border-input focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            Read the record
          </Link>
        </div>
      </section>
    </PublicLayout>
  );
}
