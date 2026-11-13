import { AppView } from "./AppView";
import { LangProvider } from "./i18n";
import "./styles.css";

export function App() {
  return (
    <LangProvider>
      <AppView />
    </LangProvider>
  );
}
