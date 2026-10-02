(function($) {
    "use strict";
	
	
    // DOCUMENT.READY FUNCTION start
    $(document).ready(function() {
        // item photos
        var urlPhotos = 'img/works/';
        $('.photo').each(function(key, value) {
            $(this).css('background-image', 'url(' + urlPhotos + $(this).data('photo-src') + ')').fadeIn("slow");
        });
        // tooltip
        $('.tooltip').each(function(key, value) {
            if ($(this).hasClass('active')) {
                $(this).append('<sup class="box-tooltip active">' + $(this).text() + '</sup>');
            } else {
                $(this).append('<sup class="box-tooltip">' + $(this).text() + '</sup>');
            }
        });
        // sidebar
        $('.menu-button').on("click", function() {
            if ($('body').hasClass('mobile-experience')) {
                $("body").removeClass('mobile-experience');
            } else {
                $("body").addClass('mobile-experience');
            }
            navWorksWidth($(window).scrollTop());
        });
        // hidden container
        $('.open-hidden-container').on("click", function() {
            if ($('.hidden-container, .hidden-container-left').hasClass('open')) {
                $(".hidden-container, .hidden-container-left").removeClass('open');
                $(".hidden-container, .hidden-container-left").addClass('close');
            } else {
                $(".hidden-container, .hidden-container-left").removeClass('close');
                $(".hidden-container, .hidden-container-left").addClass('open');
            }
        });
        // lightBox
        $('.photo .bt-nav').on("click", function() {
            var idSlider = $(this).data('slider-id');
            var mystr = $(this).data('slider-items');
            var myarr = mystr.split("|");
            var item = '';
            $(this).addClass('open');
            myarr.forEach(function(value) {
                item += '<li class="slider-item ' + idSlider + '" style="background-image:url(' + urlPhotos + value + ')"></li>';
            });
            $('.lightbox').html('\
            <div class="cycle-slideshow" data-cycle-slides=".' + idSlider + '" data-cycle-pager="#page-slide-' + idSlider + '" id="' + idSlider +
                '"> \n\
                <ul> \n\
                    ' + item + ' \n\
                </ul> \n\
                <div class="page-slide" id="page-slide-' +
                idSlider + '"></div> \n\
                <span class="bt-nav close close-lightbox"><em>Close</em></span> \n\
            </div> \
        ');
            if (myarr.length <= 1) $('.lightbox').hide();
            $('.lightbox').show();
            setTimeout(function() {
                $('.lightbox').addClass('open');
            }, 40);
            $('#' + idSlider + '').cycle();
        });
        $(document).on("click", ".close-lightbox", function() {
            $('.lightbox, .photo').removeClass('open');
            setTimeout(function() {
                $('.lightbox').hide().empty();
            }, 400);
        });
        // navMobile
        navMobile();
    });
    // DOCUMENT.READY FUNCTION end
	
	
    // WINDOW.SCROLL FUNCTION start
    // scroll
    $(window).scroll(function() {
        var scrollTop = $(window).scrollTop();
        var scrollTop2 = $(window).scrollTop() + $('.box-menu-works').height();
        // header
        if ($(window).width() > 880) {
            if (scrollTop < ($('#page-home').height() - 70)) {
                if ($('body').hasClass('open')) {
                    $("body").removeClass('mobile-experience');
                    $("body").css('padding-left', '0');
                    $("#header").stop().animate({
                        left: '-50px'
                    }, 300, function() {
                        // end animation
                        $("body").removeClass('secondary-experience open');
                        $("#header").css('left', 0).css('top', '-70px');
                        $("#header").stop().animate({
                            top: '0'
                        }, 300);
                    });
                } else {
                    $("#header").stop().animate({
                        top: '0'
                    }, 300, function() {
                        // end animation
                        $("body").removeClass('secondary-experience');
                    });
                }
            } else {
                if ($('body').hasClass('secondary-experience')) {
                    $("#header").css('top', 0);
                } else {
                    $("#header").stop().animate({
                        top: '-70px'
                    }, 300, function() {
                        // end animation
                        $("body").addClass('secondary-experience open');
                        $("#header").css('top', 0).css('left', '-50px');
                        $("#header").stop().animate({
                            left: '0'
                        }, 300);
                        $("body").css('padding-left', '0');
                    });
                }
            }
        }
        navWorksWidth(scrollTop);
        // navigation
        if (scrollTop >= $("#page-home").offset().top && scrollTop < $("#page-about").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-home']").addClass('active');
        } else if (scrollTop >= $("#page-about").offset().top && scrollTop < $("#item-page-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-about']").addClass('active');
        } else if (scrollTop >= $("#item-page-1").offset().top && scrollTop < $("#item-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-page-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-1").offset().top && scrollTop2 < $("#item-2").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-2").offset().top && scrollTop2 < $("#item-3").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-2']").addClass('active');
        } else if (scrollTop2 >= $("#item-3").offset().top && scrollTop2 < $("#item-4").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-3']").addClass('active');
        } else if (scrollTop2 >= $("#item-4").offset().top && scrollTop2 < $("#item-5").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-4']").addClass('active');
        } else if (scrollTop2 >= $("#item-5").offset().top && scrollTop2 < $("#item-page-2").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-5']").addClass('active');
        } else if (scrollTop >= $("#item-page-2").offset().top && scrollTop < $("#item-1-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-page-2']").addClass('active');
        } else if (scrollTop2 >= $("#item-1-1").offset().top && scrollTop2 < $("#item-2-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-1-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-2-1").offset().top && scrollTop2 < $("#item-3-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-2-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-3-1").offset().top && scrollTop2 < $("#item-4-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-3-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-4-1").offset().top && scrollTop2 < $("#item-5-1").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-4-1']").addClass('active');
        } else if (scrollTop2 >= $("#item-5-1").offset().top && scrollTop2 < $("#page-services").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='item-5-1']").addClass('active');
        } else if (scrollTop >= $("#page-services").offset().top && scrollTop < $("#page-news").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-services']").addClass('active');
        } else if (scrollTop >= $("#page-news").offset().top && scrollTop < $("#page-testimonials").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-news']").addClass('active');
        } else if (scrollTop >= $("#page-testimonials").offset().top && scrollTop < $("#page-contact").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-testimonials']").addClass('active');
        } else if (scrollTop >= $("#page-contact").offset().top && scrollTop < $("#page-footer").offset().top) {
            $('nav .navscroll').removeClass('active');
            $("nav").find("[data-idpage='page-contact']").addClass('active');
        }
    });
    // WINDOW.SCROLL FUNCTION end
	
	
    // WINDOW.RESIZE FUNCTION start
    $(window).resize(function() {
        navMobile();
        navWorksWidth($(window).scrollTop());
    });
    // WINDOW.RESIZE FUNCTION end
	
	
    // WINDOW.LOAD FUNCTION start
    $(window).load(function() {
        navWorksWidth($(window).scrollTop());
    });
    // WINDOW.LOAD FUNCTION end
	
	
    //
    function navWorksWidth(scrollTop) {
        if ($(window).width() > 900) {
            // item page 1
            if (scrollTop > ($("#item-page-1").offset().top + ($("#page-home").height() / 2)) && scrollTop < ($("#item-page-2").offset().top - 70)) {
                $("#menu-item-page-1").addClass('fixed');
                if ($(window).width() > 880) {
                    if ($('body').hasClass('mobile-experience')) {
                        $("#menu-item-page-1").css('width', ($(window).width() / 2) - 200 + 'px');
                    } else {
                        $("#menu-item-page-1").css('width', ($(window).width() / 2) - 0 + 'px');
                    }
                }
            } else {
                $('#menu-item-page-1').removeClass('fixed').css('width', '50%');
            }
            // item page 2
            if (scrollTop > ($("#item-page-2").offset().top + ($("#page-home").height() / 2)) && scrollTop < ($("#page-services").offset().top - 70)) {
                $("#menu-item-page-2").addClass('fixed');
                if ($(window).width() > 880) {
                    if ($('body').hasClass('mobile-experience')) {
                        $("#menu-item-page-2").css('width', ($(window).width() / 2) - 200 + 'px');
                    } else {
                        $("#menu-item-page-2").css('width', ($(window).width() / 2) - 0 + 'px');
                    }
                }
            } else {
                $('#menu-item-page-2').removeClass('fixed').css('width', '50%');
            }
        }
    }

    function navMobile() {
        if ($(window).width() < 900) {
            $("body").addClass("secondary-experience mobile open");
        } else {
            $("body").removeClass("secondary-experience mobile");
        }
    }
	
	
})(jQuery);