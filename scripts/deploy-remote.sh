#!/usr/bin/env bash

# Load environment variables from .env
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Configuration
DEPLOY_PATH="${DEPLOY_PATH:-.}"
SERVICE_NAME="${DEPLOY_SERVICE_NAME:-cast-magnet-link}"
REMOTE_USER="${REMOTE_USER:-www-data}"

# Check if SSH_HOST is configured
if [ -z "$SSH_HOST" ] || [ "$SSH_HOST" = "{server}" ]; then
  echo "⚠ SSH_HOST is not configured in .env"
  echo ""
  echo "Please enter your SSH hostname or IP address"
  echo "(This can be a shortcut from ~/.ssh/config or an IP address)"
  read -p "SSH Host: " SSH_HOST_INPUT

  if [ -z "$SSH_HOST_INPUT" ]; then
    echo "✗ SSH_HOST is required for deployment"
    exit 1
  fi

  SSH_HOST="$SSH_HOST_INPUT"

  # Ask if they want to save to .env
  echo ""
  read -p "Save SSH_HOST to .env for future deployments? (y/n) " -n 1 -r
  echo ""
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    if [ -f .env ]; then
      # Update existing .env
      if grep -q "^SSH_HOST=" .env; then
        # Replace existing SSH_HOST line
        sed -i.bak "s|^SSH_HOST=.*|SSH_HOST=$SSH_HOST|" .env && rm .env.bak
      else
        # Add SSH_HOST to end
        echo "SSH_HOST=$SSH_HOST" >> .env
      fi
    else
      # Create .env from example and set SSH_HOST
      cp .env.example .env
      sed -i.bak "s|^SSH_HOST=.*|SSH_HOST=$SSH_HOST|" .env && rm .env.bak
    fi
    echo "✓ SSH_HOST saved to .env"
  fi
  echo ""
fi

echo "╔════════════════════════════════════════════════╗"
echo "║      Deploying Cast Magnet Link (Remote)      ║"
echo "╚════════════════════════════════════════════════╝"
echo "     SSH Host:    ${SSH_HOST}"
echo "     Deploy Path: ${DEPLOY_PATH}"
echo "     Service:     ${SERVICE_NAME}"
echo

# Step 1: Test SSH connection
echo "Testing SSH connection..."
if ! ssh "$SSH_HOST" "echo 'Connected successfully'" > /dev/null 2>&1; then
  echo "✗ Failed to connect to $SSH_HOST"
  echo "  Please ensure 'ssh $SSH_HOST' works without errors"
  exit 1
fi
echo "✓ SSH connection successful"
echo

# Step 2: Create deployment directory if it doesn't exist
echo "Creating deployment directory on remote server..."
ssh "$SSH_HOST" "sudo mkdir -p $DEPLOY_PATH && sudo chown $REMOTE_USER:$REMOTE_USER $DEPLOY_PATH"
echo "✓ Directory ready"
echo

# Step 3: Sync files to remote server
echo "Syncing files to remote server..."
rsync -av --delete \
  --exclude 'node_modules' \
  --exclude 'data' \
  --exclude '.git' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.wrangler' \
  --exclude 'wrangler.local.toml' \
  --exclude '.DS_Store' \
  ./ "$SSH_HOST:$DEPLOY_PATH/"

if [ $? -ne 0 ]; then
  echo "✗ Failed to sync files"
  exit 1
fi
echo "✓ Files synced successfully"
echo

# Step 4: Set proper ownership and permissions
echo "Setting ownership and permissions..."
ssh "$SSH_HOST" "
  sudo chown -R $REMOTE_USER:$REMOTE_USER $DEPLOY_PATH
  find $DEPLOY_PATH -type d -exec chmod 755 {} \;
  find $DEPLOY_PATH -type f -exec chmod 644 {} \;
  chmod 755 $DEPLOY_PATH/data 2>/dev/null || true
"
if [ $? -ne 0 ]; then
  echo "✗ Failed to set permissions"
  exit 1
fi
echo "✓ Ownership and permissions configured"
echo

# Step 5: Install dependencies on remote server
echo "Installing dependencies on remote server..."
ssh "$SSH_HOST" "cd $DEPLOY_PATH && npm install --production"
if [ $? -ne 0 ]; then
  echo "✗ Failed to install dependencies"
  exit 1
fi
echo "✓ Dependencies installed"
echo

# Step 6: Create data directory
echo "Creating data directory..."
ssh "$SSH_HOST" "sudo mkdir -p $DEPLOY_PATH/data && sudo chown $REMOTE_USER:$REMOTE_USER $DEPLOY_PATH/data && sudo chmod 755 $DEPLOY_PATH/data"
echo "✓ Data directory ready"
echo

# Step 7: Check and copy .env file
echo "Checking .env file on remote server..."
ENV_EXISTS=$(ssh "$SSH_HOST" "[ -f $DEPLOY_PATH/.env ] && echo 'yes' || echo 'no'")
if [ "$ENV_EXISTS" = "no" ]; then
  echo "⚠ Warning: .env file not found on remote server"
  echo "  Copying .env.example as template..."
  ssh "$SSH_HOST" "cd $DEPLOY_PATH && cp .env.example .env"
  echo "  ⚠ IMPORTANT: You must configure .env on the remote server:"
  echo "     ssh $SSH_HOST 'nano $DEPLOY_PATH/.env'"
  echo
  read -p "Do you want to edit .env now? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    ssh -t "$SSH_HOST" "nano $DEPLOY_PATH/.env"
  else
    echo "  Remember to configure .env before starting the service!"
    echo
  fi
else
  echo "✓ .env file exists"
  echo
fi

# Step 8: Secure .env file permissions
echo "Securing .env file permissions..."
ssh "$SSH_HOST" "sudo chown $REMOTE_USER:$REMOTE_USER $DEPLOY_PATH/.env && sudo chmod 600 $DEPLOY_PATH/.env"
if [ $? -ne 0 ]; then
  echo "⚠ Warning: Failed to set .env permissions"
else
  echo "✓ .env file secured (600 permissions)"
fi
echo

# Step 9: Install and start systemd service
echo "Setting up systemd service..."
ssh "$SSH_HOST" "sudo cp $DEPLOY_PATH/$SERVICE_NAME.service /etc/systemd/system/ && \
  sudo systemctl daemon-reload && \
  sudo systemctl enable $SERVICE_NAME"

if [ $? -ne 0 ]; then
  echo "✗ Failed to setup systemd service"
  exit 1
fi
echo "✓ Service installed and enabled"
echo

# Step 10: Restart the service
echo "Restarting service..."
ssh "$SSH_HOST" "sudo systemctl restart $SERVICE_NAME"
if [ $? -ne 0 ]; then
  echo "✗ Failed to restart service"
  echo "  Check logs with: ssh $SSH_HOST 'sudo journalctl -u $SERVICE_NAME -n 50'"
  exit 1
fi
echo "✓ Service restarted successfully"
echo

# Step 11: Check service status
echo "Checking service status..."
ssh "$SSH_HOST" "sudo systemctl is-active $SERVICE_NAME" > /dev/null 2>&1
if [ $? -eq 0 ]; then
  echo "✓ Service is running"
  echo
  echo "════════════════════════════════════════════════"
  echo "✓ Deployment completed successfully!"
  echo "════════════════════════════════════════════════"
  echo
  echo "To view logs:"
  echo "  ssh $SSH_HOST 'sudo journalctl -u $SERVICE_NAME -f'"
  echo
  echo "To check status:"
  echo "  ssh $SSH_HOST 'sudo systemctl status $SERVICE_NAME'"
  echo
else
  echo "✗ Service failed to start"
  echo "  Check logs with: ssh $SSH_HOST 'sudo journalctl -u $SERVICE_NAME -n 50'"
  exit 1
fi
