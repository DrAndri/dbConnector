const minify = require('gulp-minify');

gulp.task('compress', function() {
  gulp.src(['html/*.js', 'html/*.mjs'])
    .pipe(minify())
    .pipe(gulp.dest('html'))
});
