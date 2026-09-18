import { PublicLayout } from "@/components/public-layout";
import { BACKTEST, COSTS, TRADING } from "@/lib/public-facts";

/**
 * How the system decides, and what has already been ruled out.
 *
 * The falsification section is the point of this page. A method page that only lists
 * what a system does is marketing; one that lists what was tested and failed is the
 * thing a reader can actually use to judge it.
 */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border py-10 first:border-t-0 first:pt-0">
      <h2 className="type-h2 text-foreground">{title}</h2>
      <div className="measure mt-4 space-y-4 text-muted-foreground">{children}</div>
    </section>
  );
}

export default function Method() {
  return (
    <PublicLayout>
      <div className="mx-auto max-w-6xl px-6 py-16">
        <p className="type-label mb-5 text-primary">Method</p>
        <h1 className="type-display measure text-foreground">
          Written down first, then run.
        </h1>
        <p className="measure mt-5 text-lg leading-relaxed text-muted-foreground">
          The rules, the kill condition and the reporting obligations were fixed before the
          test, which is what makes the result mean anything.
        </p>

        <div className="mt-14">
          <Section title="What it looks for">
            <p>
              The system trades {TRADING.pairs.length} major pairs —{" "}
              {TRADING.pairs.join(", ")} — and only inside two windows:{" "}
              {TRADING.killZones.join(" and ")} UTC. Outside those hours it generates
              nothing.
            </p>
            <p>
              Setups are scored on a fixed confluence model built from higher-timeframe
              alignment and an entry trigger. The score is a number, not a judgement call,
              and the same inputs always produce the same score.
            </p>
            <p>
              Every signal carries an entry, a stop and a target before it is published, and
              expires after {TRADING.expiryHours} hours if neither level is reached.
            </p>
          </Section>

          <Section title="What stops it trading">
            <p>
              A correlation guard measures each candidate against everything already open,
              using a measured correlation matrix rather than an assumed one. Because EUR/USD
              and USD/CHF move opposite each other, going long one and short the other is the
              same bet placed twice, not a hedge — so the guard reads direction, not just
              instrument.
            </p>
            <p>
              A signal the guard holds is still recorded and still published. Dropping it
              would put a hole in the only clean forward dataset there is.
            </p>
          </Section>

          <Section title="How outcomes are decided">
            <p>
              Outcomes are replayed from 5-minute price data across the exact window of the
              trade, then reconciled against the broker's own deal records. An earlier
              validator compared trades against whatever candles happened to be most recent,
              and could label a trade a loss on price action that occurred before the signal
              existed. That defect was found, and 10 of 64 recorded stop-outs turned out to
              be physically impossible.
            </p>
            <p>
              Execution is measured against the broker's cash, not against the model. On the
              comparable trades the mean absolute difference between the modelled result and
              the money was 1.55 R — against a programme whose entire measured edge is{" "}
              {BACKTEST.expectancyR} R.
            </p>
          </Section>

          <Section title="What has been ruled out">
            <p>
              The confluence score does not rank trades. Correlation between score and
              realised outcome is {BACKTEST.confidenceCorrelation.toFixed(4)} across{" "}
              {BACKTEST.trades.toLocaleString()} trades — indistinguishable from none.
            </p>
            <p>
              The win rate is the rate a coin flip would produce for these stop and target
              distances. Observed 32.41% against a driftless expectation of 33.38%.
            </p>
            <p>
              Costs dominate. Commission measured from real broker deals is{" "}
              {COSTS.commissionPipsRoundTurn} pips per round turn, against a break-even
              spread of {COSTS.breakEvenSpreadPips} pips — roughly three times the entire
              gross edge.
            </p>
            <p>
              The pre-registered programme is exhausted. All three windows have been run and
              neither the kill condition nor the declared success condition was met, but the
              upper bound of the confidence interval now sits below the level that would make
              the strategy worth trading.
            </p>
          </Section>

          <Section title="Why it is still published">
            <p>
              Because a negative result reported honestly is worth more than a positive one
              that cannot be checked, and because the forward dataset only stays clean if
              every signal keeps being recorded — including the ones nobody would want to
              show.
            </p>
          </Section>
        </div>

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
