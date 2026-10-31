import React, { useState } from "react";
import {
  Box,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Typography,
  FormControl,
  FormLabel,
  FormGroup,
  FormControlLabel,
  Checkbox,
  Select,
  MenuItem,
  Alert,
  CircularProgress,
  useTheme,
  useMediaQuery,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import EmailIcon from "@mui/icons-material/Email";
import { preRegisterAPI } from "../services/api";

const PreRegisterButton = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));

  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  const [formData, setFormData] = useState({
    email: "",
    name: "",
    phone: "",
    interests: [],
    referralSource: "other",
    notificationPreferences: {
      email: true,
      sms: false,
    },
  });

  const [formErrors, setFormErrors] = useState({});

  const interestOptions = [
    { value: "fashion", label: "Fashion" },
    { value: "clothing", label: "Clothing" },
    { value: "shopping", label: "Shopping" },
    { value: "style", label: "Style" },
    { value: "trends", label: "Trends" },
    { value: "wardrobe", label: "Wardrobe Management" },
    { value: "accessories", label: "Accessories" },
  ];

  const referralOptions = [
    { value: "social_media", label: "Social Media" },
    { value: "friend_referral", label: "Friend Referral" },
    { value: "search_engine", label: "Search Engine" },
    { value: "advertisement", label: "Advertisement" },
    { value: "blog", label: "Blog/Article" },
    { value: "other", label: "Other" },
  ];

  const validateForm = () => {
    const errors = {};

    if (!formData.email) {
      errors.email = "Email is required";
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      errors.email = "Please enter a valid email address";
    }

    if (!formData.name || formData.name.trim().length < 2) {
      errors.name = "Name must be at least 2 characters long";
    }

    if (
      formData.phone &&
      !/^[\+]?[1-9][\d]{0,15}$/.test(formData.phone.replace(/\s/g, ""))
    ) {
      errors.phone = "Please enter a valid phone number";
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: value,
    }));

    // Clear specific field error when user starts typing
    if (formErrors[field]) {
      setFormErrors((prev) => ({
        ...prev,
        [field]: "",
      }));
    }
  };

  const handleInterestChange = (interest, checked) => {
    setFormData((prev) => ({
      ...prev,
      interests: checked
        ? [...prev.interests, interest]
        : prev.interests.filter((i) => i !== interest),
    }));
  };
  const handleSubmit = async () => {
    if (!validateForm()) return;

    setLoading(true);
    setError("");

    try {
      const response = await preRegisterAPI.register({
        ...formData,
        phone: formData.phone.replace(/\s/g, ""), // Remove spaces from phone
      });

      if (response.success) {
        setSuccess(true);
        // Reset form
        setFormData({
          email: "",
          name: "",
          phone: "",
          interests: [],
          referralSource: "other",
          notificationPreferences: {
            email: true,
            sms: false,
          },
        });
      }
    } catch (err) {
      if (err.response?.data?.message) {
        setError(err.response.data.message);
      } else if (err.response?.data?.errors) {
        setError(err.response.data.errors.map((e) => e.msg).join(", "));
      } else {
        setError("Something went wrong. Please try again later.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    setSuccess(false);
    setError("");
    setFormErrors({});
  };

  return (
    <>
      <Button
        variant="contained"
        size="large"
        onClick={() => setOpen(true)}
        startIcon={<EmailIcon />}
        sx={{
          background: "linear-gradient(45deg, #e9cd7d 30%, #f4d998 90%)",
          color: "#000",
          fontWeight: "bold",
          fontSize: isMobile ? "1rem" : "1.1rem",
          px: isMobile ? 3 : 4,
          py: isMobile ? 1.5 : 2,
          borderRadius: "25px",
          textTransform: "none",
          boxShadow: "0 4px 20px rgba(233, 205, 125, 0.4)",
          "&:hover": {
            background: "linear-gradient(45deg, #d4b366 30%, #e9cd7d 90%)",
            boxShadow: "0 6px 25px rgba(233, 205, 125, 0.6)",
            transform: "translateY(-2px)",
          },
          transition: "all 0.3s ease",
        }}
      >
        Pre-Register Now
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        maxWidth="sm"
        fullWidth
        fullScreen={isMobile}
        PaperProps={{
          sx: {
            borderRadius: isMobile ? 0 : "16px",
            background: "linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%)",
          },
        }}
      >
        <DialogTitle
          sx={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            background: "linear-gradient(45deg, #e9cd7d 30%, #f4d998 90%)",
            color: "#000",
            fontWeight: "bold",
          }}
        >
          <Typography variant="h5" component="div">
            {success ? "Registration Successful!" : "Pre-Register for Shazlo"}
          </Typography>
          <Button onClick={handleClose} sx={{ minWidth: "auto", p: 1 }}>
            <CloseIcon />
          </Button>
        </DialogTitle>

        <DialogContent sx={{ p: 3 }}>
          {success ? (
            <Box textAlign="center" py={2}>
              <Typography variant="h6" gutterBottom color="success.main">
                🎉 Welcome to Shazlo!
              </Typography>
              <Typography variant="body1" color="text.secondary">
                Thank you for pre-registering! We'll notify you as soon as the
                app is available for download.
              </Typography>
            </Box>
          ) : (
            <Box>
              {error && (
                <Alert severity="error" sx={{ mb: 2 }}>
                  {error}
                </Alert>
              )}

              <Box mb={2}>
                <TextField
                  fullWidth
                  label="Email Address"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange("email", e.target.value)}
                  error={!!formErrors.email}
                  helperText={formErrors.email}
                  required
                />
              </Box>

              <Box mb={2}>
                <TextField
                  fullWidth
                  label="Full Name"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  error={!!formErrors.name}
                  helperText={formErrors.name}
                  required
                />
              </Box>

              <Box mb={2}>
                <TextField
                  fullWidth
                  label="Phone Number (Optional)"
                  value={formData.phone}
                  onChange={(e) => handleInputChange("phone", e.target.value)}
                  error={!!formErrors.phone}
                  helperText={
                    formErrors.phone ||
                    "We may send SMS notifications if enabled"
                  }
                />
              </Box>

              <Box mb={2}>
                <FormControl fullWidth>
                  <FormLabel
                    component="legend"
                    sx={{ mb: 1, fontWeight: "bold" }}
                  >
                    What interests you most? (Optional)
                  </FormLabel>
                  <FormGroup row>
                    {interestOptions.map((option) => (
                      <FormControlLabel
                        key={option.value}
                        control={
                          <Checkbox
                            checked={formData.interests.includes(option.value)}
                            onChange={(e) =>
                              handleInterestChange(
                                option.value,
                                e.target.checked
                              )
                            }
                            sx={{ color: "#e9cd7d" }}
                          />
                        }
                        label={option.label}
                        sx={{ width: isMobile ? "100%" : "50%" }}
                      />
                    ))}
                  </FormGroup>
                </FormControl>
              </Box>

              <Box mb={2}>
                <FormControl fullWidth>
                  <FormLabel sx={{ mb: 1, fontWeight: "bold" }}>
                    How did you hear about us?
                  </FormLabel>
                  <Select
                    value={formData.referralSource}
                    onChange={(e) =>
                      handleInputChange("referralSource", e.target.value)
                    }
                  >
                    {referralOptions.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>

              <Box mb={2}>
                <FormControl component="fieldset">
                  <FormLabel component="legend" sx={{ fontWeight: "bold" }}>
                    Notification Preferences
                  </FormLabel>
                  <FormGroup>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={formData.notificationPreferences.email}
                          onChange={(e) =>
                            handleInputChange("notificationPreferences", {
                              ...formData.notificationPreferences,
                              email: e.target.checked,
                            })
                          }
                          sx={{ color: "#e9cd7d" }}
                        />
                      }
                      label="Email notifications"
                    />
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={formData.notificationPreferences.sms}
                          onChange={(e) =>
                            handleInputChange("notificationPreferences", {
                              ...formData.notificationPreferences,
                              sms: e.target.checked,
                            })
                          }
                          sx={{ color: "#e9cd7d" }}
                        />
                      }
                      label="SMS notifications (requires phone number)"
                    />
                  </FormGroup>
                </FormControl>
              </Box>
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 3, pt: 0 }}>
          {success ? (
            <Button
              onClick={handleClose}
              variant="contained"
              fullWidth
              sx={{
                background: "linear-gradient(45deg, #e9cd7d 30%, #f4d998 90%)",
                color: "#000",
                fontWeight: "bold",
                py: 1.5,
              }}
            >
              Close
            </Button>
          ) : (
            <Box sx={{ display: "flex", gap: 2, width: "100%" }}>
              <Button onClick={handleClose} variant="outlined" sx={{ flex: 1 }}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                variant="contained"
                disabled={loading}
                sx={{
                  flex: 2,
                  background:
                    "linear-gradient(45deg, #e9cd7d 30%, #f4d998 90%)",
                  color: "#000",
                  fontWeight: "bold",
                  py: 1.5,
                }}
                startIcon={loading && <CircularProgress size={20} />}
              >
                {loading ? "Registering..." : "Pre-Register"}
              </Button>
            </Box>
          )}
        </DialogActions>
      </Dialog>
    </>
  );
};

export default PreRegisterButton;
