import React from "react";
import {
  Container,
  Grid,
  Typography,
  Button,
  Box,
  TextField,
  Paper,
  IconButton,
} from "@mui/material";
import {
  Download,
  Email,
  Phone,
  LocationOn,
  Instagram,
  Facebook,
  Twitter,
} from "@mui/icons-material";
import { makeStyles } from "@mui/styles";
import Navbar from "./Navbar";
import Footer from "./Footer";

const useStyles = makeStyles((theme) => ({
  hero: {
    background: "linear-gradient(45deg, #FFF9C4 30%, #FFEBEE 90%)",
    padding: "80px 0",
    textAlign: "center",
  },
  downloadButton: {
    background: "linear-gradient(45deg, #FFD700 30%, #FFC107 90%)",
    color: "black",
    fontWeight: "bold",
    padding: "10px 24px",
  },
  pinkText: {
    color: "#F06292",
  },
  yellowBg: {
    backgroundColor: "#FFF9C4",
  },
  contactForm: {
    padding: "40px",
    backgroundColor: "#FFF9C4",
  },
}));

function ContactPage() {
  const classes = useStyles();

  return (
    <div style={{ paddingTop: 90,backgroundColor: "white"   }}>
      <Navbar />

      {/* Contact Hero */}
      <Box className={classes.hero}>
        <Container>
          <Typography
            variant="h2"
            component="h1"
            gutterBottom
            sx={{ fontWeight: "bold" }}
          >
            Get in <span className={classes.pinkText}>Touch</span>
          </Typography>
          <Typography variant="h5" gutterBottom sx={{ mb: 4 }}>
            We'd love to hear from you! Reach out for support, partnerships, or
            just to say hello.
          </Typography>
        </Container>
      </Box>

      {/* Contact Content */}
      <Container sx={{ py: 8 }}>
        <Grid container spacing={6}>
          <Grid
            size={{
              xs: 12,
              md: 6
            }}>
            <Paper elevation={3} className={classes.contactForm}>
              <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold" }}>
                Send Us a Message
              </Typography>
              <form>
                <Grid container spacing={3}>
                  <Grid
                    size={{
                      xs: 12,
                      sm: 6
                    }}>
                    <TextField
                      required
                      fullWidth
                      label="First Name"
                      variant="outlined"
                    />
                  </Grid>
                  <Grid
                    size={{
                      xs: 12,
                      sm: 6
                    }}>
                    <TextField
                      required
                      fullWidth
                      label="Last Name"
                      variant="outlined"
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      required
                      fullWidth
                      label="Email"
                      variant="outlined"
                      type="email"
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      required
                      fullWidth
                      label="Subject"
                      variant="outlined"
                    />
                  </Grid>
                  <Grid size={12}>
                    <TextField
                      required
                      fullWidth
                      label="Message"
                      variant="outlined"
                      multiline
                      rows={4}
                    />
                  </Grid>
                  <Grid size={12}>
                    <Button
                      type="submit"
                      variant="contained"
                      size="large"
                      className={classes.downloadButton}
                    >
                      Send Message
                    </Button>
                  </Grid>
                </Grid>
              </form>
            </Paper>
          </Grid>
          <Grid
            size={{
              xs: 12,
              md: 6
            }}>
            <Typography variant="h4" gutterBottom sx={{ fontWeight: "bold" }}>
              Contact Information
            </Typography>
            <Typography variant="body1" sx={{
              marginBottom: "16px"
            }}>
              Have questions about Shazlo? We're here to help!
            </Typography>

            <Box sx={{ mt: 4 }}>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <Email sx={{ mr: 2, color: "#F06292" }} />
                <Typography variant="body1">support@shazlo.com</Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "center", mb: 2 }}>
                <Phone sx={{ mr: 2, color: "#F06292" }} />
                <Typography variant="body1">+1 (555) 123-4567</Typography>
              </Box>
              <Box sx={{ display: "flex", alignItems: "flex-start", mb: 2 }}>
                <LocationOn sx={{ mr: 2, color: "#F06292", mt: 0.5 }} />
                <Typography variant="body1">
                  123 Fashion Avenue
                  <br />
                  New York, NY 10001
                  <br />
                  United States
                </Typography>
              </Box>
            </Box>

            <Box sx={{ mt: 6 }}>
              <Typography variant="h5" gutterBottom sx={{ fontWeight: "bold" }}>
                Follow Us
              </Typography>
              <Box>
                <IconButton aria-label="instagram" sx={{ color: "#F06292" }}>
                  <Instagram fontSize="large" />
                </IconButton>
                <IconButton aria-label="facebook" sx={{ color: "#F06292" }}>
                  <Facebook fontSize="large" />
                </IconButton>
                <IconButton aria-label="twitter" sx={{ color: "#F06292" }}>
                  <Twitter fontSize="large" />
                </IconButton>
              </Box>
            </Box>
          </Grid>
        </Grid>
      </Container>

      {/* Download CTA */}
      <Box className={classes.yellowBg} sx={{ py: 8 }}>
        <Container sx={{ textAlign: "center" }}>
          <Typography variant="h3" gutterBottom sx={{ fontWeight: "bold" }}>
            Don't Have the App Yet?
          </Typography>
          <Typography variant="h5" gutterBottom sx={{ mb: 4 }}>
            Download Shazlo now and start your personalized fashion journey.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<Download />}
            className={classes.downloadButton}
          >
            Download Now
          </Button>
        </Container>
      </Box>

      <Footer />
    </div>
  );
}

export default ContactPage;
