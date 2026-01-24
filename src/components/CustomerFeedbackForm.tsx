import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Star, CheckCircle, ArrowLeft } from "lucide-react";
import logo from "@/assets/logo.png";

interface Job {
  id: string;
  service_type: string;
  completed_at: string | null;
  agent_id: string | null;
  agent_name?: string;
}

const CustomerFeedbackForm = () => {
  const { token, leadId } = useParams<{ token: string; leadId?: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [selectedJob, setSelectedJob] = useState<string | null>(leadId || null);
  const [rating, setRating] = useState(0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (token) {
      validateAndFetchJobs();
    }
  }, [token]);

  const validateAndFetchJobs = async () => {
    try {
      setLoading(true);

      // Validate token
      const { data: custId, error: tokenError } = await supabase.rpc(
        "validate_customer_token",
        { p_token: token }
      );

      if (tokenError || !custId) {
        setError("Invalid or expired link.");
        return;
      }

      setCustomerId(custId);

      // Fetch completed jobs for this customer
      const { data: jobsData } = await supabase
        .from("leads")
        .select(`
          id,
          service_type,
          completed_at,
          assigned_agent_id
        `)
        .eq("customer_id", custId)
        .eq("status", "completed")
        .order("completed_at", { ascending: false })
        .limit(10);

      // Get agent names
      const jobsWithAgents = await Promise.all(
        (jobsData || []).map(async (job) => {
          if (job.assigned_agent_id) {
            const { data: profile } = await supabase
              .from("profiles")
              .select("full_name")
              .eq("id", job.assigned_agent_id)
              .single();
            return {
              ...job,
              agent_id: job.assigned_agent_id,
              agent_name: profile?.full_name || "Your technician",
            };
          }
          return { ...job, agent_id: null, agent_name: "Your technician" };
        })
      );

      setJobs(jobsWithAgents);

      // Auto-select if only one job or leadId provided
      if (leadId) {
        setSelectedJob(leadId);
      } else if (jobsWithAgents.length === 1) {
        setSelectedJob(jobsWithAgents[0].id);
      }

    } catch (err) {
      console.error("Error:", err);
      setError("Something went wrong.");
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (rating === 0) {
      toast({
        title: "Rating required",
        description: "Please select a star rating",
        variant: "destructive",
      });
      return;
    }

    if (!selectedJob || !customerId) return;

    const job = jobs.find((j) => j.id === selectedJob);
    if (!job || !job.agent_id) {
      toast({
        title: "Error",
        description: "Could not find job details",
        variant: "destructive",
      });
      return;
    }

    setSubmitting(true);
    try {
      const { error: insertError } = await supabase.from("customer_feedback").insert({
        customer_id: customerId,
        lead_id: selectedJob,
        agent_id: job.agent_id,
        rating,
        comment: comment.trim() || null,
      });

      if (insertError) throw insertError;

      setSubmitted(true);
      toast({
        title: "Thank you! 🎉",
        description: "Your feedback has been submitted.",
      });

      // If low rating, could trigger alert here
      if (rating <= 3) {
        console.log("Low rating submitted - admin alert could be triggered");
      }

    } catch (err: any) {
      toast({
        title: "Error",
        description: err.message || "Failed to submit feedback",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CardTitle className="text-red-600">Error</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-b from-green-50 to-white p-4">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-4" />
            <CardTitle className="text-green-600">Thank You!</CardTitle>
            <CardDescription>
              Your feedback helps us improve our service.
              {rating >= 4 && (
                <span className="block mt-2">
                  We'd love if you could share your experience on Google!
                </span>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {rating >= 4 && (
              <Button asChild className="w-full">
                <a
                  href="https://g.page/r/YOUR_GOOGLE_REVIEW_LINK"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Leave a Google Review ⭐
                </a>
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => navigate(`/customer/${token}`)}
              className="w-full"
            >
              Back to Portal
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      {/* Header */}
      <header className="bg-[#0077B6] text-white p-4 shadow-md">
        <div className="max-w-lg mx-auto flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-white hover:bg-white/20"
            onClick={() => navigate(`/customer/${token}`)}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <img src={logo} alt="Be Cool" className="h-10" />
          <h1 className="font-bold">Rate Your Service</h1>
        </div>
      </header>

      <main className="max-w-lg mx-auto p-4 space-y-6">
        {/* Job Selection (if multiple) */}
        {jobs.length > 1 && !leadId && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Select Service</CardTitle>
              <CardDescription>Which service would you like to rate?</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {jobs.map((job) => (
                <button
                  key={job.id}
                  onClick={() => setSelectedJob(job.id)}
                  className={`w-full p-3 rounded-lg text-left transition-colors ${
                    selectedJob === job.id
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted hover:bg-muted/80"
                  }`}
                >
                  <p className="font-medium text-sm">{job.service_type}</p>
                  <p className="text-xs opacity-80">
                    {job.completed_at
                      ? new Date(job.completed_at).toLocaleDateString()
                      : "Recently completed"}
                  </p>
                </button>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Rating Card */}
        <Card>
          <CardHeader>
            <CardTitle className="text-center">How was your experience?</CardTitle>
            <CardDescription className="text-center">
              Tap to rate your service
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Star Rating */}
            <div className="flex justify-center gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setRating(star)}
                  onMouseEnter={() => setHoverRating(star)}
                  onMouseLeave={() => setHoverRating(0)}
                  className="p-1 transition-transform hover:scale-110"
                >
                  <Star
                    className={`h-10 w-10 transition-colors ${
                      star <= (hoverRating || rating)
                        ? "fill-yellow-400 text-yellow-400"
                        : "text-gray-300"
                    }`}
                  />
                </button>
              ))}
            </div>

            {rating > 0 && (
              <p className="text-center text-sm text-muted-foreground">
                {rating === 1 && "We're sorry to hear that 😔"}
                {rating === 2 && "We'll work to improve 🤔"}
                {rating === 3 && "Thank you for your feedback 👍"}
                {rating === 4 && "Great to hear! 😊"}
                {rating === 5 && "Wonderful! Thank you! 🎉"}
              </p>
            )}

            {/* Comment */}
            <div>
              <Textarea
                placeholder="Tell us more about your experience (optional)"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
              />
            </div>

            {/* Submit */}
            <Button
              onClick={handleSubmit}
              disabled={rating === 0 || submitting || !selectedJob}
              className="w-full h-12"
            >
              {submitting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Submitting...
                </>
              ) : (
                "Submit Feedback"
              )}
            </Button>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default CustomerFeedbackForm;
