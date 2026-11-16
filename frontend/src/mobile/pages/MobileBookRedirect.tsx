import { Navigate, useLocation, useParams } from 'react-router-dom';
import { briefingPath } from '../../utils/routes';

// FR-BRF-001
export default function MobileBookRedirect() {
  const { bookId = '' } = useParams();
  const { state } = useLocation();
  return <Navigate to={briefingPath(bookId)} replace state={state} />;
}
