import { deliverySteps } from "@/lib/site";

export function DeliverySteps() {
  return (
    <ol className="delivery-steps">
      {deliverySteps.map((s, i) => (
        <li key={s.title} className="delivery-steps__item">
          <span className="delivery-steps__num" aria-hidden="true">
            {i + 1}
          </span>
          <div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
