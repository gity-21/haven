#!/bin/bash
git filter-branch -f --env-filter '
if [ "$GIT_AUTHOR_NAME" = "gity" ] || [ "$GIT_AUTHOR_NAME" = "gity-21" ]; then
    export GIT_AUTHOR_NAME="mehmet"
    export GIT_AUTHOR_EMAIL="mehmet@example.com"
fi
if [ "$GIT_COMMITTER_NAME" = "gity" ] || [ "$GIT_COMMITTER_NAME" = "gity-21" ]; then
    export GIT_COMMITTER_NAME="mehmet"
    export GIT_COMMITTER_EMAIL="mehmet@example.com"
fi
' --tag-name-filter cat -- --branches --tags
