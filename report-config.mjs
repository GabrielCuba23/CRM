export const defaultReports = {
  clientsWeekly: false,
  financeTwiceMonthly: false,
  hour: 9,
};
export function validateReports(r = defaultReports) {
  if (
    !r ||
    typeof r.clientsWeekly !== "boolean" ||
    typeof r.financeTwiceMonthly !== "boolean" ||
    !Number.isInteger(r.hour) ||
    r.hour < 0 ||
    r.hour > 23
  )
    throw Error("Configuración de reportes no válida.");
  return {
    clientsWeekly: r.clientsWeekly,
    financeTwiceMonthly: r.financeTwiceMonthly,
    hour: r.hour,
  };
}
