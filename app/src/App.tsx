import { AppProvider, type AppState } from './state/app';
import { AppLayout } from './components/templates/AppLayout';

/** Root component: makes the state available and renders the layout. */
export function App(props: { state: AppState }) {
  return (
    <AppProvider state={props.state}>
      <AppLayout />
    </AppProvider>
  );
}
