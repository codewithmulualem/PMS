import PlanPerformanceTable from "./PlanPerformance";
import StrategicGoals from "./StrategicGoals";

export default function DirectoratePlans() {
  return (
    <div className="page-enter">
      <div className="card" style={{ marginBottom: 12 }}>
        <div className="card-title">የዳይሬክቶሬት ዕቅድ ማዘጋጀት</div>
        <div className="card-sub">
          ዓመታዊ ስትራቴጂካዊ ግቦችን ወደ የዳይሬክቶሬት የሩብ ዓመት ዕቅዶች ይቀይሩ።
          እያንዳንዱ ዕቅድ በዳይሬክቶሬትዎ ውስጥ ያሉ መምሪያዎች እንዲፈጽሙት የሚመራ መነሻ ነው።
        </div>
      </div>
      <StrategicGoals embedded />
      <PlanPerformanceTable tierLabel="ዳይሬክቶሬት" />
    </div>
  );
}
