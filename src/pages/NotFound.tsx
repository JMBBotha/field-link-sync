import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import FlAuthFrame from "@/components/auth/FlAuthFrame";

const NotFound = () => {
  const location = useLocation();
  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);
  return (
    <FlAuthFrame>
      <div className="big404">404</div>
      <h2>Page not found</h2>
      <p className="sub">Oops! There's nothing at <b>{location.pathname}</b>.</p>
      <div className="trk"><a href="/" className="pill">Return to Home</a></div>
    </FlAuthFrame>
  );
};

export default NotFound;
